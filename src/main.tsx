import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ServiceContext } from './hooks/useService';
import { ContentRepository } from './storage/repository';
import { ContentService } from './services/contentService';
import { SEED_PACK } from './content/seed';
import './styles/app.css';

const container = document.getElementById('root');

async function bootstrap(): Promise<void> {
  if (container === null) {
    throw new Error('找不到 #root 容器');
  }
  const repository = await ContentRepository.open();
  const service = new ContentService(repository);
  await service.initialize(SEED_PACK);

  createRoot(container).render(
    <StrictMode>
      <ServiceContext.Provider value={service}>
        <App />
      </ServiceContext.Provider>
    </StrictMode>,
  );
}

void bootstrap();
