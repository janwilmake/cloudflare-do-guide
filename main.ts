export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const id = env.MY_DO_NAMESPACE.idFromName(url.pathname);
    const stub = env.MY_DO_NAMESPACE