import { createContext, useContext } from 'react';
import type { ContentService } from '../services/contentService';

export const ServiceContext = createContext<ContentService | null>(null);

export function useService(): ContentService {
  const service = useContext(ServiceContext);
  if (service === null) {
    throw new Error('useService 必须在 ServiceProvider 内使用');
  }
  return service;
}
