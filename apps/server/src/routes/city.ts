import { CITY_DISTRICTS, type CityResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';

export function registerCityRoutes(app: FastifyInstance): void {
  app.get('/city', { preHandler: app.authenticate }, (): CityResponse => {
    return {
      districts: [...CITY_DISTRICTS],
      bases: app.repos.bases.listSummaries(),
    };
  });
}
