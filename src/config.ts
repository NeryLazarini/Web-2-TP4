function leerNumero(valor: string | undefined, porDefecto: number): number {
  if (!valor) return porDefecto;
  const parsed = Number(valor);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : porDefecto;
}

export const config = {
  port: leerNumero(process.env.PORT, 3000),
  catalogoUrl: (process.env.CATALOGO_URL || 'https://dummyjson.com/products').replace(/\/+$/, ''),
  catalogoTimeoutMs: leerNumero(process.env.CATALOGO_TIMEOUT_MS, 5000),
  catalogoDelayMs: leerNumero(process.env.CATALOGO_DELAY_MS, 0),
} as const;