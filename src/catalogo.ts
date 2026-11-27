import { config } from './config.js';
import type { MotivoFallo } from './types.js';

export interface ProductoCatalogo {
  id: number;
  titulo: string;
  precio: number;
  imagen: string;
}

export type ResultadoConsulta =
  | { ok: true; producto: ProductoCatalogo }
  | { ok: false; productoId: number; motivo: MotivoFallo; detalle: string };

interface DummyJsonProduct {
  id: number;
  title: string;
  price: number;
  thumbnail?: string;
  images?: string[];
}

async function consultarUno(productoId: number): Promise<ResultadoConsulta> {
  const queryDelay = config.catalogoDelayMs > 0 ? `?delay=${config.catalogoDelayMs}` : '';
  const url = `${config.catalogoUrl}/${productoId}${queryDelay}`;

  try {
    const respuesta = await fetch(url, {
      signal: AbortSignal.timeout(config.catalogoTimeoutMs),
    });

    if (respuesta.status === 404) {
      return {
        ok: false,
        productoId,
        motivo: 'INEXISTENTE',
        detalle: `El producto ${productoId} no existe en el catalogo.`,
      };
    }

    if (!respuesta.ok) {
      return {
        ok: false,
        productoId,
        motivo: 'ERROR_CATALOGO',
        detalle: `El catalogo respondio con estado ${respuesta.status}.`,
      };
    }

    const data = (await respuesta.json()) as DummyJsonProduct;
    const imagen = data.thumbnail || data.images?.[0] || '';

    return {
      ok: true,
      producto: {
        id: data.id,
        titulo: data.title,
        precio: data.price,
        imagen,
      },
    };
  } catch (error) {
    const esTimeout =
      error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');

    if (esTimeout) {
      return {
        ok: false,
        productoId,
        motivo: 'TIMEOUT',
        detalle: `El catalogo no respondio dentro de ${config.catalogoTimeoutMs} ms.`,
      };
    }

    return {
      ok: false,
      productoId,
      motivo: 'ERROR_CATALOGO',
      detalle: 'No se pudo conectar con el catalogo externo.',
    };
  }
}

export async function consultarProductosEnParalelo(
  productoIds: number[]
): Promise<ResultadoConsulta[]> {
  const resultados = await Promise.allSettled(
    productoIds.map((id) => consultarUno(id))
  );

  return resultados.map((res, index) => {
    if (res.status === 'fulfilled') {
      return res.value;
    }
    return {
      ok: false,
      productoId: productoIds[index],
      motivo: 'ERROR_CATALOGO',
      detalle: 'Error inesperado al consultar el catalogo.',
    };
  });
}