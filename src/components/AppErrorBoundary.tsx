import { Component, type ErrorInfo, type ReactNode } from 'react';
import packageJson from '../../package.json';

const getAppVersion = () => {
  if (typeof packageJson === 'object' && packageJson && 'version' in packageJson) {
    return packageJson.version as string;
  }
  return 'unknown';
};

type AppErrorBoundaryState = {
  error: Error | null;
  errorInfo: ErrorInfo | null;
};

type AppErrorBoundaryProps = {
  children: ReactNode;
};

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    errorInfo: null
  };

  private previousOnError: OnErrorEventHandler | null = null;
  private previousOnUnhandledRejection: ((this: WindowEventHandlers, ev: PromiseRejectionEvent) => unknown) | null = null;

  componentDidMount() {
    this.previousOnError = window.onerror;
    this.previousOnUnhandledRejection = window.onunhandledrejection;

    window.onerror = (message, source, lineno, colno, error) => {
      console.error('Global error:', { message, source, lineno, colno, error });
      if (this.previousOnError) {
        return this.previousOnError(message, source, lineno, colno, error);
      }
      return false;
    };

    window.onunhandledrejection = (event) => {
      console.error('Unhandled rejection:', event.reason);
      if (this.previousOnUnhandledRejection) {
        return this.previousOnUnhandledRejection.call(window, event);
      }
      return undefined;
    };
  }

  componentWillUnmount() {
    window.onerror = this.previousOnError;
    window.onunhandledrejection = this.previousOnUnhandledRejection;
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error boundary caught:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  private buildDebugInfo() {
    const version = getAppVersion();
    const platform = window.navigator.platform;
    const userAgent = window.navigator.userAgent;
    const error = this.state.error;
    const errorInfo = this.state.errorInfo;
    return [
      `App version: ${version}`,
      `Platform: ${platform}`,
      `User agent: ${userAgent}`,
      '',
      `Error: ${error?.message ?? 'Unknown error'}`,
      '',
      'Stack:',
      error?.stack ?? 'No stack available.',
      '',
      'Component stack:',
      errorInfo?.componentStack ?? 'No component stack available.'
    ].join('\n');
  }

  private handleCopyDebugInfo = async () => {
    const debugInfo = this.buildDebugInfo();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(debugInfo);
        return;
      }
    } catch (error) {
      console.warn('Clipboard write failed:', error);
    }

    const textarea = document.createElement('textarea');
    textarea.value = debugInfo;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  render() {
    const { error, errorInfo } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="app error-boundary">
        <div className="error-boundary-card">
          <h1>Something went wrong</h1>
          <p>The app hit an unexpected error. You can reload the app or copy debug info.</p>
          <div className="error-boundary-actions">
            <button onClick={() => window.location.reload()}>Reload app</button>
            <button onClick={this.handleCopyDebugInfo}>Copy debug info</button>
          </div>
          <details className="error-boundary-details">
            <summary>Error details</summary>
            <pre>{error.message}</pre>
            <pre>{error.stack}</pre>
            {errorInfo?.componentStack && <pre>{errorInfo.componentStack}</pre>}
          </details>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
