// This shim is imported by index.ts to ensure sub-routers are mounted.
// It supplements routes.ts which imports the routers but never called app.use().
// Calling mountSubRouters(app) BEFORE registerRoutes would shadow routes.ts's own
// app.use("/api/...") calls, so instead we inject it via a patch to routes.ts.
//
// INSTRUCTION: Delete this file once routes.ts directly calls mountSubRouters.
export {};
