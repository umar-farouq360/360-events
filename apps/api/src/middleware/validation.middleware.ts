import type { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, type ZodIssue } from 'zod';

interface ParsedRequest {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export function validateRequest(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const validated = (await schema.parseAsync({
        body: req.body as unknown,
        query: req.query,
        params: req.params,
      })) as ParsedRequest;

      // Overwrite request properties with parsed (and optionally transformed/stripped) data
      if (validated.body !== undefined) {
        req.body = validated.body;
      }
      if (validated.query !== undefined) {
        req.query = validated.query as Request['query'];
      }
      if (validated.params !== undefined) {
        req.params = validated.params as Request['params'];
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            // Only expose field paths and standard validation messages.
            // DO NOT echo the input payload back to prevent leaking sensitive secrets.
            details: error.issues.map((issue: ZodIssue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        });
        return;
      }
      next(error);
    }
  };
}