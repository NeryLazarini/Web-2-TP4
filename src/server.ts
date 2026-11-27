import express, { type Response } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.js';
import { consultarProductosEnParalelo } from './catalogo.js';
import { EstadoApp } from './estado.js';
import type { FalloPropuesta, MensajeCliente, MensajeServidor } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const estado = new EstadoApp();

// Clientes WebSocket que ya se unieron con nombre
const clientesWs = new Map<WebSocket, string>();
// Clientes SSE (pantallas)
const clientesSse = new Set<Response>();

// Servir frontend estatico
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// --- Helpers de envio ---

function enviarWs(ws: WebSocket, mensaje: MensajeServidor): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(mensaje));
  }
}

function broadcastWs(mensaje: MensajeServidor): void {
  const payload = JSON.stringify(mensaje);
  for (const ws of clientesWs.keys()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function enviarSse(res: Response, evento: string, data: unknown): void {
  res.write(`event: ${evento}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastSse(): void {
  const snapshot = estado.obtenerEstadoPantalla();
  for (const res of clientesSse) {
    if (!res.writableEnded) {
      enviarSse(res, 'estado', snapshot);
    }
  }
}

// --- Endpoint SSE para la Pantalla ---

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clientesSse.add(res);
  enviarSse(res, 'estado', estado.obtenerEstadoPantalla());

  req.on('close', () => {
    clientesSse.delete(res);
    res.end();
  });
});

// --- Validacion estricta de mensajes entrantes ---

function esEnteroPositivo(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0;
}

function parsearMensajeCliente(
  crudo: string
): { ok: true; mensaje: MensajeCliente } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(crudo);
  } catch {
    return { ok: false, error: 'El mensaje no es un JSON valido.' };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'El mensaje debe ser un objeto JSON.' };
  }

  const obj = data as Record<string, unknown>;
  const tipo = obj.tipo;

  if (typeof tipo !== 'string') {
    return { ok: false, error: 'Falta el campo "tipo" o no es un texto.' };
  }

  switch (tipo) {
    case 'unirse':
      if (typeof obj.nombre !== 'string') {
        return { ok: false, error: 'El campo "nombre" es obligatorio y debe ser texto.' };
      }
      return { ok: true, mensaje: { tipo: 'unirse', nombre: obj.nombre } };

    case 'proponer':
      if (!Array.isArray(obj.productoIds)) {
        return { ok: false, error: 'El campo "productoIds" debe ser un arreglo de numeros.' };
      }
      if (obj.productoIds.length === 0 || obj.productoIds.length > 10) {
        return { ok: false, error: 'Debes proponer entre 1 y 10 productos por vez.' };
      }
      if (!obj.productoIds.every(esEnteroPositivo)) {
        return { ok: false, error: 'Todos los "productoIds" deben ser enteros positivos.' };
      }
      return { ok: true, mensaje: { tipo: 'proponer', productoIds: obj.productoIds } };

    case 'votar':
    case 'quitar_voto':
    case 'quitar_producto':
      if (!esEnteroPositivo(obj.productoId)) {
        return { ok: false, error: 'El campo "productoId" debe ser un entero positivo.' };
      }
      return { ok: true, mensaje: { tipo, productoId: obj.productoId } };

    default:
      return { ok: false, error: `Tipo de mensaje desconocido: "${tipo}".` };
  }
}

// --- Logica de propuesta asincrona (no bloqueante) ---

async function manejarPropuesta(
  ws: WebSocket,
  participante: string,
  productoIds: number[]
): Promise<void> {
  const fallos: FalloPropuesta[] = [];
  const idsParaConsultar: number[] = [];
  const vistosEnEstaPropuesta = new Set<number>();

  for (const id of productoIds) {
    if (vistosEnEstaPropuesta.has(id) || estado.existeProducto(id)) {
      fallos.push({
        productoId: id,
        motivo: 'DUPLICADO',
        detalle: `El producto ${id} ya estaba en la lista o repetido en la propuesta.`,
      });
      continue;
    }
    vistosEnEstaPropuesta.add(id);
    idsParaConsultar.push(id);
  }

  const agregados: number[] = [];

  if (idsParaConsultar.length > 0) {
    const resultados = await consultarProductosEnParalelo(idsParaConsultar);

    for (const res of resultados) {
      if (!res.ok) {
        fallos.push({
          productoId: res.productoId,
          motivo: res.motivo,
          detalle: res.detalle,
        });
        continue;
      }

      const insercion = estado.agregarProducto(res.producto, participante);
      if (!insercion.ok) {
        fallos.push({
          productoId: res.producto.id,
          motivo: 'DUPLICADO',
          detalle: `El producto ${res.producto.id} ya fue agregado por otro participante.`,
        });
      } else {
        agregados.push(res.producto.id);
      }
    }
  }

  // Solo quien propuso recibe el detalle de agregados y fallos
  enviarWs(ws, {
    tipo: 'resultado_propuesta',
    agregados,
    fallos,
  });

  // El resto solo ve los productos que efectivamente se agregaron
  if (agregados.length > 0) {
    broadcastWs({
      tipo: 'lista_actualizada',
      productos: estado.obtenerListaOrdenada(),
    });
    broadcastSse();
  }
}

// --- Conexion WebSocket ---

wss.on('connection', (ws) => {
  ws.on('message', (rawData) => {
    const texto = rawData.toString();
    const parseado = parsearMensajeCliente(texto);

    if (!parseado.ok) {
      enviarWs(ws, { tipo: 'error', mensaje: parseado.error });
      return;
    }

    const msg = parseado.mensaje;
    const participanteActual = clientesWs.get(ws);

    if (msg.tipo === 'unirse') {
      if (participanteActual) {
        enviarWs(ws, { tipo: 'error', mensaje: 'Ya te encuentras unido a la sala.' });
        return;
      }

      const registro = estado.registrarParticipante(msg.nombre);
      if (!registro.ok) {
        enviarWs(ws, { tipo: 'error', mensaje: registro.error });
        return;
      }

      clientesWs.set(ws, registro.nombre);

      enviarWs(ws, {
        tipo: 'estado_inicial',
        tuNombre: registro.nombre,
        productos: estado.obtenerListaOrdenada(),
        participantes: estado.obtenerParticipantes(),
      });

      broadcastWs({
        tipo: 'participantes_actualizados',
        participantes: estado.obtenerParticipantes(),
      });
      broadcastSse();
      return;
    }

    // Cualquier otra accion requiere haberse unido primero
    if (!participanteActual) {
      enviarWs(ws, { tipo: 'error', mensaje: 'Debes unirte con un nombre antes de realizar esta accion.' });
      return;
    }

    switch (msg.tipo) {
      case 'proponer':
        // Se ejecuta de forma asincrona sin bloquear el event loop ni a otros clientes
        void manejarPropuesta(ws, participanteActual, msg.productoIds);
        break;

      case 'votar': {
        const res = estado.votar(msg.productoId, participanteActual);
        if (!res.ok) {
          enviarWs(ws, { tipo: 'error', mensaje: res.error });
          return;
        }
        broadcastWs({ tipo: 'lista_actualizada', productos: estado.obtenerListaOrdenada() });
        broadcastSse();
        break;
      }

      case 'quitar_voto': {
        const res = estado.quitarVoto(msg.productoId, participanteActual);
        if (!res.ok) {
          enviarWs(ws, { tipo: 'error', mensaje: res.error });
          return;
        }
        broadcastWs({ tipo: 'lista_actualizada', productos: estado.obtenerListaOrdenada() });
        broadcastSse();
        break;
      }

      case 'quitar_producto': {
        const res = estado.quitarProducto(msg.productoId, participanteActual);
        if (!res.ok) {
          enviarWs(ws, { tipo: 'error', mensaje: res.error });
          return;
        }
        broadcastWs({ tipo: 'lista_actualizada', productos: estado.obtenerListaOrdenada() });
        broadcastSse();
        break;
      }
    }
  });

  ws.on('close', () => {
    const nombre = clientesWs.get(ws);
    if (nombre) {
      clientesWs.delete(ws);
      estado.desconectarParticipante(nombre);
      broadcastWs({
        tipo: 'participantes_actualizados',
        participantes: estado.obtenerParticipantes(),
      });
      broadcastSse();
    }
  });
});

server.listen(config.port, () => {
  console.log(`Servidor corriendo en http://localhost:${config.port}`);
  console.log(`- Participantes: http://localhost:${config.port}/`);
  console.log(`- Pantalla (SSE): http://localhost:${config.port}/pantalla.html`);
  console.log(
    `- Catalogo: ${config.catalogoUrl} (timeout: ${config.catalogoTimeoutMs}ms, delay: ${config.catalogoDelayMs}ms)`
  );
});