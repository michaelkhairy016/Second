import { Component, type ErrorInfo, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-[200px] items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6 text-center space-y-3">
              <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 grid place-items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <h3 className="font-semibold">Something went wrong</h3>
              <p className="text-sm text-muted-foreground">An unexpected error occurred in this section.</p>
              {import.meta.env.DEV && this.state.error && (
                <pre className="text-left text-xs text-destructive bg-muted p-2 rounded-md max-h-32 overflow-auto">{this.state.error.message}</pre>
              )}
              <Button variant="outline" size="sm" onClick={() => this.setState({ hasError: false, error: null })}>
                Try again
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
