import { useSyncExternalStore } from 'react';
import type { ServiceState } from '../services/contentService';
import { useService } from './useService';

export function useServiceState(): ServiceState {
  const service = useService();
  return useSyncExternalStore(
    (callback) => service.subscribe(callback),
    () => service.getState(),
    () => service.getState(),
  );
}
