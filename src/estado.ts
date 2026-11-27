import type { ProductoCatalogo } from './catalogo.js';
import type { EstadoPantalla, ProductoPropuesto } from './types.js';

interface ProductoInterno {
  id: number;
  titulo: string;
  precio: number;
  imagen: string;
  propuestoPor: string;
  votos: Set<string>;
}

export class EstadoApp {
  // key: nombre en minusculas, value: nombre original mostrado
  private participantes = new Map<string, string>();
  private productos = new Map<number, ProductoInterno>();

  registrarParticipante(nombreCrudo: string): { ok: true; nombre: string } | { ok: false; error: string } {
    const nombre = nombreCrudo.trim();

    if (nombre.length < 2 || nombre.length > 20) {
      return { ok: false, error: 'El nombre debe tener entre 2 y 20 caracteres.' };
    }

    const clave = nombre.toLowerCase();
    if (this.participantes.has(clave)) {
      return { ok: false, error: `Ya existe un participante conectado llamado "${nombre}".` };
    }

    this.participantes.set(clave, nombre);
    return { ok: true, nombre };
  }

  desconectarParticipante(nombre: string): void {
    this.participantes.delete(nombre.toLowerCase());
  }

  obtenerParticipantes(): string[] {
    return Array.from(this.participantes.values());
  }

  existeProducto(productoId: number): boolean {
    return this.productos.has(productoId);
  }

  agregarProducto(
    producto: ProductoCatalogo,
    propuestoPor: string
  ): { ok: true } | { ok: false; motivo: 'DUPLICADO' } {
    // Doble chequeo atomico para evitar duplicados si dos personas proponen lo mismo a la vez
    if (this.productos.has(producto.id)) {
      return { ok: false, motivo: 'DUPLICADO' };
    }

    this.productos.set(producto.id, {
      id: producto.id,
      titulo: producto.titulo,
      precio: producto.precio,
      imagen: producto.imagen,
      propuestoPor,
      votos: new Set<string>(),
    });

    return { ok: true };
  }

  votar(productoId: number, participante: string): { ok: true } | { ok: false; error: string } {
    const producto = this.productos.get(productoId);
    if (!producto) {
      return { ok: false, error: `El producto ${productoId} no esta en la lista.` };
    }

    if (producto.votos.has(participante)) {
      return { ok: false, error: 'Ya votaste este producto.' };
    }

    producto.votos.add(participante);
    return { ok: true };
  }

  quitarVoto(productoId: number, participante: string): { ok: true } | { ok: false; error: string } {
    const producto = this.productos.get(productoId);
    if (!producto) {
      return { ok: false, error: `El producto ${productoId} no esta en la lista.` };
    }

    if (!producto.votos.has(participante)) {
      return { ok: false, error: 'No habias votado este producto.' };
    }

    producto.votos.delete(participante);
    return { ok: true };
  }

  quitarProducto(productoId: number, participante: string): { ok: true } | { ok: false; error: string } {
    const producto = this.productos.get(productoId);
    if (!producto) {
      return { ok: false, error: `El producto ${productoId} no esta en la lista.` };
    }

    if (producto.propuestoPor !== participante) {
      return {
        ok: false,
        error: `Solo ${producto.propuestoPor} puede quitar este producto.`,
      };
    }

    this.productos.delete(productoId);
    return { ok: true };
  }

  obtenerListaOrdenada(): ProductoPropuesto[] {
    return Array.from(this.productos.values())
      .map((p) => ({
        id: p.id,
        titulo: p.titulo,
        precio: p.precio,
        imagen: p.imagen,
        propuestoPor: p.propuestoPor,
        votos: Array.from(p.votos),
        cantidadVotos: p.votos.size,
      }))
      .sort((a, b) => b.cantidadVotos - a.cantidadVotos || a.id - b.id);
  }

  obtenerEstadoPantalla(): EstadoPantalla {
    return {
      productos: this.obtenerListaOrdenada(),
      cantidadParticipantes: this.participantes.size,
    };
  }
}