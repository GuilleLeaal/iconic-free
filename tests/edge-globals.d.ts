// Superficie mínima del runtime usada por la función. La validación de APIs
// del cliente usa los tipos reales de supabase-js fijados en el lockfile.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response>): unknown;
};
