/** Aggregates the v3 feature routers; mounted once in app.ts behind requireAuth. */
import { Router } from 'express';
import { capsulesRouter } from './capsules';
import { chaptersRouter } from './chapters';
import { companionRouter } from './companion';
import { correlationsRouter } from './correlations';
import { growthRouter } from './growth';
import { intentionsRouter } from './intentions';
import { lettersRouter } from './letters';
import { resurfaceRouter } from './resurface';
import { ritualsRouter } from './rituals';
import { unwrappedRouter } from './unwrapped';

export const v3Router: Router = Router();
v3Router.use(
  capsulesRouter,
  resurfaceRouter,
  unwrappedRouter,
  lettersRouter,
  chaptersRouter,
  growthRouter,
  intentionsRouter,
  ritualsRouter,
  companionRouter,
  correlationsRouter,
);
