import type { RequestHandler, Express, Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.middleware.js';
import type { Permission } from './permissions.js';

interface ExpressRoute {
  path: string;
  methods: Record<string, boolean>;
}

interface ExpressLayer {
  name?: string;
  regexp?: RegExp;
  route?: ExpressRoute;
  handle?: { stack?: ExpressLayer[] };
}

interface ExpressWithRouter {
  router: { stack: ExpressLayer[] };
}

export type AccessLevel = 'public' | 'authenticated' | { permission: Permission };

export interface RouteDefinition {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  access: AccessLevel;
  handlers: RequestHandler[];
}

class RouteRegistry {
  private registeredPaths = new Set<string>();

  public register(router: Router, def: RouteDefinition): void {
    const { method, path, access, handlers } = def;
    const routeKey = `${method.toUpperCase()} ${path}`;
    
    if (this.registeredPaths.has(routeKey)) {
      throw new Error(`Route ${routeKey} is already registered.`);
    }
    
    this.registeredPaths.add(routeKey);

    const middleware: RequestHandler[] = [];
    
    if (access === 'authenticated') {
      middleware.push(requireAuth);
    } else if (typeof access === 'object' && access.permission) {
      middleware.push(requireAuth, requirePermission(access.permission));
    }

    router[method](path, ...middleware, ...handlers);
  }

  public getRegisteredRoutes(): string[] {
    return Array.from(this.registeredPaths);
  }

  /**
   * Enforces deny-by-default by checking the active Express stack against the registry.
   * Fails startup if an unregistered route was mounted directly via app.get() etc.
   */
  public verifyNoUnregisteredRoutes(app: Express): void {
    const unregistered: string[] = [];

    const checkStack = (stack: ExpressLayer[], basePath = ''): void => {
      for (const layer of stack) {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
          const path = basePath + layer.route.path;
          for (const method of methods) {
            const key = `${method} ${path}`;
            if (!this.registeredPaths.has(key)) {
              unregistered.push(key);
            }
          }
        } else if (layer.name === 'router' && layer.handle?.stack) {
          const match = layer.regexp?.toString().match(/^\/\^\\\/(.*?)\\\/\?\(\?=\\\/|\$\)/);
          const routerPath = match?.[1] ? `/${match[1]}` : '';
          checkStack(layer.handle.stack, basePath + routerPath);
        }
      }
    };

    const expressApp = app as unknown as ExpressWithRouter;
    checkStack(expressApp.router.stack);

    if (unregistered.length > 0) {
      throw new Error(`SECURITY FATAL: Unregistered routes detected. All routes must use the RouteRegistry: \n${unregistered.join('\n')}`);
    }
  }
}

export const registry = new RouteRegistry();