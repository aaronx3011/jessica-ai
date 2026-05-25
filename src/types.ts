export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type AppState = 'landing' | 'chat';

export interface User {
  _id: string;
  googleId: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: string;
  lastLogin: string;
  isNew: boolean;
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}
