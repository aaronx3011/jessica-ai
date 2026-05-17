export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type AppState = 'landing' | 'login' | 'chat';

export interface User {
  email: string;
}
