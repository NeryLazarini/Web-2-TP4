# TP4 — Lista Compartida en Tiempo Real (Regalo Grupal)

Aplicación web en tiempo real construida con **Node.js + TypeScript** que permite a un grupo de participantes proponer productos del catálogo externo de **DummyJSON**, votarlos en vivo y visualizar el ranking actualizado automáticamente en una pantalla compartida.

- **Participantes:** comunicación bidireccional mediante **WebSocket** (`ws` + API estándar del navegador).
- **Pantalla compartida:** actualizaciones unidireccionales mediante **Server-Sent Events (SSE)** (`EventSource`).
- **Estado:** completamente en memoria del servidor (sin base de datos).

---

## Instalación y ejecución

### Requisitos
- Node.js (versión LTS, v20 o superior)
- npm

### Pasos

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Crear el archivo `.env` en la raíz del proyecto a partir de `.env.example`:
   ```env
   PORT=3000
   CATALOGO_URL=[https://dummyjson.com/products](https://dummyjson.com/products)
   CATALOGO_TIMEOUT_MS=5000
   CATALOGO_DELAY_MS=0
   ```

3. Ejecutar el servidor:
   - Modo desarrollo (con recarga automática):
     ```bash
     npm run dev
     ```
   - Modo normal:
     ```bash
     npm start
     ```

4. Abrir en el navegador:
   - **Participantes:** `http://localhost:3000/` (abrir en varias pestañas para simular distintos usuarios)
   - **Pantalla en vivo (SSE):** `http://localhost:3000/pantalla.html`

### Cómo simular un catálogo lento sin modificar código

DummyJSON acepta el parámetro `?delay=<ms>`. Para simular demoras o forzar un timeout:
1. Modificar `CATALOGO_DELAY_MS` en el archivo `.env` (por ejemplo, `CATALOGO_DELAY_MS=4000` para demorar 4 segundos, o `6000` para superar el timeout de `5000` ms).
2. Reiniciar el servidor con `npm run dev`.

---

## Contrato de mensajes

Todos los mensajes WebSocket son objetos JSON con un campo `tipo`. El servidor valida estrictamente cada mensaje recibido y rechaza cualquier formato inválido sin interrumpir el servicio.

### 1. WebSocket: Cliente → Servidor

| `tipo` | Campos | Cuándo se envía |
| :--- | :--- | :--- |
| `unirse` | `nombre: string` | Al ingresar a la sala por primera vez. |
| `proponer` | `productoIds: number[]` | Cuando un participante propone entre 1 y 10 IDs enteros positivos del catálogo. |
| `votar` | `productoId: number` | Cuando un participante vota un producto existente en la lista. |
| `quitar_voto` | `productoId: number` | Cuando un participante retira su voto previo sobre un producto. |
| `quitar_producto` | `productoId: number` | Cuando el autor de un producto decide eliminarlo de la lista. |

### 2. WebSocket: Servidor → Cliente

| `tipo` | Campos | Destinatario y cuándo se envía |
| :--- | :--- | :--- |
| `estado_inicial` | `tuNombre: string`, `productos: ProductoPropuesto[]`, `participantes: string[]` | **Solo al cliente que se une**, inmediatamente después de aceptar su nombre. |
| `participantes_actualizados` | `participantes: string[]` | **Broadcast a todos los participantes**, cuando alguien entra o cierra su conexión. |
| `lista_actualizada` | `productos: ProductoPropuesto[]` | **Broadcast a todos los participantes**, cuando se agrega/quita un producto o cambia un voto. La lista siempre viaja ordenada por votos descendentes. |
| `resultado_propuesta` | `agregados: number[]`, `fallos: FalloPropuesta[]` | **Solo a quien propuso**, al finalizar las consultas en paralelo al catálogo. |
| `error` | `mensaje: string` | **Solo al cliente emisor**, ante un JSON inválido, tipo desconocido, campos fuera de rango o regla de negocio incumplida. |

### 3. Server-Sent Events (SSE): Servidor → Pantalla (`GET /events`)

| Evento (`event:`) | Payload (`data:`) | Cuándo se envía |
| :--- | :--- | :--- |
| `estado` | `{ productos: ProductoPropuesto[], cantidadParticipantes: number }` | Al conectarse la pantalla (estado inicial) y cada vez que cambia la lista o la cantidad de participantes conectados. |

**Estructura de tipos auxiliares:**
- `ProductoPropuesto`: `{ id, titulo, precio, imagen, propuestoPor, votos: string[], cantidadVotos }`
- `FalloPropuesta`: `{ productoId, motivo: 'INEXISTENTE' | 'TIMEOUT' | 'DUPLICADO' | 'ERROR_CATALOGO', detalle }`

---

## Decisiones de diseño

- **Nombres de participantes:** se eliminan espacios en los extremos (`trim`). Se aceptan nombres de entre **2 y 20 caracteres** y **no se permiten repetidos** (comparación insensible a mayúsculas/minúsculas) mientras el participante esté conectado. Al cerrar la pestaña, el nombre queda libre nuevamente.
- **Productos repetidos:** si un producto ya existe en la lista (o viene duplicado en la misma propuesta), se descarta y se informa al proponente con motivo `DUPLICADO`. Si dos participantes proponen el mismo ID en simultáneo mientras el catálogo demora, al volver las respuestas el servidor vuelve a verificar de forma atómica antes de insertar: el primero en llegar lo agrega y el segundo recibe `DUPLICADO`, evitando duplicados en la lista.
- **Quién puede quitar productos:** **solo el participante que propuso el producto** puede quitarlo de la lista. La validación se aplica en el servidor comparando `producto.propuestoPor` con el usuario asociado a la conexión WebSocket.
- **Tiempo máximo de espera del catálogo (`5000 ms`):** se eligió un timeout de 5 segundos (`AbortSignal.timeout`) porque es suficiente para tolerar latencia normal de una API pública externa (e incluso demoras simuladas de 3–4 segundos), pero lo bastante acotado para no dejar al usuario esperando indefinidamente si DummyJSON falla o se cuelga. Todas las consultas de una misma propuesta se ejecutan en paralelo con `Promise.allSettled`.

---

## Comportamiento ante fallos o demoras del catálogo

- **Quien propuso:** mientras el servidor consulta DummyJSON, ve un aviso de espera (`Consultando catálogo...`). Al finalizar, recibe un mensaje privado `resultado_propuesta` con los IDs que sí se agregaron y el detalle exacto de cada fallo (`INEXISTENTE`, `TIMEOUT`, `DUPLICADO` o `ERROR_CATALOGO`).
- **El resto de los participantes:** no se bloquean mientras la consulta está en curso; pueden seguir votando, quitando votos o entrando/saliendo con normalidad. Tampoco reciben los errores ajenos: únicamente reciben `lista_actualizada` si al menos un producto válido fue efectivamente agregado.
- **La pantalla (SSE):** solo recibe una actualización si la lista cambió efectivamente con nuevos productos válidos.

---

## WebSocket vs. Server-Sent Events (SSE) vs. Polling

- **¿Por qué WebSocket para los participantes?** Porque la comunicación es **bidireccional y frecuente**: cada participante envía acciones (unirse, proponer, votar, quitar) y al mismo tiempo necesita recibir al instante los cambios del resto por la misma conexión persistente.
- **¿Por qué SSE para la pantalla?** Porque la pantalla es **estrictamente de solo lectura**: nunca envía datos al servidor, solo necesita recibir actualizaciones en tiempo real. SSE funciona sobre HTTP estándar, es más liviano que WebSocket para tráfico unidireccional y `EventSource` incluye reconexión automática nativa en el navegador.
- **¿Qué cambiaría si la pantalla usara polling?** La pantalla tendría que hacer peticiones HTTP periódicas (por ejemplo, `GET /estado` cada 2 o 3 segundos). Esto introduciría **latencia artificial** (los cambios no se verían al instante sino recién en el próximo ciclo) y generaría **tráfico y carga innecesarios** en el servidor incluso cuando nadie está votando ni modificando la lista.