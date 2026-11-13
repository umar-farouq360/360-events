import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';

export function configureSecurity(app: Express, allowedOrigins: string[]) {
  // Trust the first proxy to ensure req.ip is set correctly and cannot be trivially spoofed 
  // via X-Forwarded-For headers when deployed behind a trusted load balancer.
  app.set('trust proxy', 1);

  // Apply standard security headers
  app.use(helmet());

  // Configure CORS
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }));

  // Preserve raw body for webhook signature verification before JSON parsing
  app.use('/api/v1/webhooks/paystack', express.raw({ type: 'application/json', limit: '1mb' }));

  // Apply strict JSON body parsing for all other routes
  app.use(express.json({ limit: '100kb' }));
}