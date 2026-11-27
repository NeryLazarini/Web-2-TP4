// --- Modelo de datos ---

export interface ProductoPropuesto {
  id: number;
  titulo: string;
  precio: number;
  imagen: string;
  propuestoPor: string;
  votos: string[]; // Nombres de los participantes que votaron
  cantidadVotos: number;
}

export type MotivoFallo = 'INEXISTENTE' | 'TIMEOUT' | 'DUPLICADO' | 'ERROR_CATALOGO';

export interface FalloPropuesta {
  productoId: number;
  motivo: MotivoFallo;
  detalle: string;
}

// --- Mensajes Cliente -> Servidor (WebSocket) ---

export type MensajeCliente =
  | { tipo: 'unirse'; nombre: string }
  | { tipo: 'proponer'; productoIds: number[] }
  | { tipo: 'votar'; productoId: number }
  | { tipo: 'quitar_voto'; productoId: number }
  | { tipo: 'quitar_producto'; productoId: number };

// --- Mensajes Servidor -> Cliente (WebSocket) ---

export type MensajeServidor =
  | {
      tipo: 'estado_inicial';
      tuNombre: string;
      productos: ProductoPropuesto[];
      participantes: string[];
    }
  | {
      tipo: 'lista_actualizada';
      productos: ProductoPropuesto[];
    }
  | {
      tipo: 'participantes_actualizados';
      participantes: string[];
    }
  | {
      tipo: 'resultado_propuesta';
      agregados: number[];
      fallos: FalloPropuesta[];
    }
  | {
      tipo: 'error';
      mensaje: string;
    };

// --- Payload Servidor -> Pantalla (SSE) ---

export interface EstadoPantalla {
  productos: ProductoPropuesto[];
  cantidadParticipantes: number;
}