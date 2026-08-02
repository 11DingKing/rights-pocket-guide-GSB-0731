import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AnnouncerProvider } from './app/Announcer';
import { bootstrap } from './services/bootstrap';
import { App } from './ui/App';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

function renderFatal(message: string): void {
  root.render(
    <StrictMode>
      <main id="main">
        <h1>无法加载内容</h1>
        <p role="alert">{message}</p>
      </main>
    </StrictMode>,
  );
}

async function start(): Promise<void> {
  try {
    const result = await bootstrap();
    root.render(
      <StrictMode>
        <AnnouncerProvider>
          <App
            repository={result.repository}
            activeVersion={result.activeVersion}
            latestAttempted={result.latestAttempted}
            usedBundledSeed={result.usedBundledSeed}
            {...(result.updateError === undefined
              ? {}
              : { updateError: result.updateError })}
          />
        </AnnouncerProvider>
      </StrictMode>,
    );
  } catch (cause) {
    renderFatal(
      cause instanceof Error ? cause.message : '未知错误，请稍后重试。',
    );
  }
}

void start();
