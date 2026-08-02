import type { FullPack, MaterializedPack } from '../types';
import { materializeFullPack } from './resolver';
import seedPackV1 from '../../materials/content-pack-v1.json';

export const SEED_PACK: MaterializedPack = materializeFullPack(
  seedPackV1 as FullPack,
);
