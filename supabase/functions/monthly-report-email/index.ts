import { handle } from "./handler.ts";

Deno.serve((request: Request) => handle(request));
