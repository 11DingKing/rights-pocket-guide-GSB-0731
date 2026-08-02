import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './ui/AppShell';
import { createAppRepository } from './services/appDeps';
import './styles.css';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) {
    return;
  }
  const root = createRoot(container);
  root.render(<p className="boot-loading">正在加载内容…</p>);
  try {
    const repository = await createAppRepository();
    root.render(
      <StrictMode>
        <AppShell repository={repository} />
      </StrictMode>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    root.render(<p role="alert">应用启动失败：{message}</p>);
  }
}

void bootstrap();
