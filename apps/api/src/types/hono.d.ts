declare module "hono" {
  export interface Context {
    json(data: any, status?: number): Response;
  }
  export class Hono {
    get(path: string, handler: (c: Context) => any): this;
    post(path: string, handler: (c: Context) => any): this;
    put(path: string, handler: (c: Context) => any): this;
    delete(path: string, handler: (c: Context) => any): this;
  }
}
