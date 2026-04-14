export interface Flashcard {
  id: string;
  question: string;
  answer: string;
  mastered: boolean;
  type: 'theory' | 'question';
  options?: string[];
  lastReviewed?: number;
}

export interface Deck {
  id: string;
  title: string;
  description: string;
  cards: Flashcard[];
  createdAt: number;
  subject?: 'Biology' | 'Physics' | 'Chemistry';
  topic?: string;
}

export type StudyFilter = 'all' | 'unmastered' | 'mastered';
