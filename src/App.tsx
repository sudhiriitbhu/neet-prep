import * as React from 'react';
import { useState, useEffect, useMemo, Component } from 'react';
import { Plus, Brain, Trash2, Edit2, Play, ChevronLeft, ChevronRight, RotateCcw, Sparkles, Search, BookOpen, CheckCircle2, XCircle, MessageSquare, Send, User, Bot, Loader2, Mic, Music, Volume2, FileUp, BarChart2, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Deck, Flashcard, StudyFilter } from './types';
import { generateFlashcards, chatWithAssistant, analyzeDocumentAndGenerateCards } from './services/gemini';
import { cn } from '@/lib/utils';
import { LiveAssistant } from './components/LiveAssistant';
import { SYLLABUS } from './constants/syllabus';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { auth, db, googleProvider, OperationType, handleFirestoreError, sanitizeData } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut, User as FirebaseUser } from 'firebase/auth';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, setDoc, getDoc, serverTimestamp, orderBy } from 'firebase/firestore';

// Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, errorInfo: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <Card className="max-w-md w-full border-red-100 shadow-xl">
            <CardHeader className="text-center">
              <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                <XCircle className="text-red-600 w-6 h-6" />
              </div>
              <CardTitle className="text-red-900">Something went wrong</CardTitle>
              <CardDescription>
                An error occurred while interacting with the database.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-900 text-slate-100 p-4 rounded-lg overflow-auto max-h-48 text-xs font-mono">
                {this.state.errorInfo}
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                className="w-full bg-red-600 hover:bg-red-700"
                onClick={() => window.location.reload()}
              >
                Reload Application
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [isStudying, setIsStudying] = useState(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [studyFilter, setStudyFilter] = useState<StudyFilter>('all');
  const [studyType, setStudyType] = useState<'all' | 'theory' | 'question'>('all');

  // Modals
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  
  // Form States
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [aiTopic, setAiTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Chat States
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
    { role: 'model', text: 'Hi! I am your NEET Prep Assistant. How can I help you study today? I can help you create new flashcard decks on any topic.' }
  ]);
  const [userInput, setUserInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);

  const [dashboardTitle, setDashboardTitle] = useState('My Decks');
  const [dashboardDescription, setDashboardDescription] = useState('Manage your study materials and track your progress.');
  const [isEditingDashboard, setIsEditingDashboard] = useState(false);

  const [selectedSubject, setSelectedSubject] = useState<'Biology' | 'Physics' | 'Chemistry'>('Biology');
  const [selectedTopic, setSelectedTopic] = useState<string>(SYLLABUS['Biology'][0]);
  const [viewMode, setViewMode] = useState<'syllabus' | 'database' | 'progress'>('syllabus');
  const [formSubject, setFormSubject] = useState<'Biology' | 'Physics' | 'Chemistry'>('Biology');
  const [formCardType, setFormCardType] = useState<'theory' | 'question'>('theory');

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Data Listener
  useEffect(() => {
    if (!user) {
      setDecks([]);
      return;
    }

    const q = query(
      collection(db, 'decks'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedDecks = snapshot.docs.map(doc => ({
        ...doc.data(),
        id: doc.id
      })) as Deck[];
      setDecks(fetchedDecks);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'decks');
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch User Profile
  useEffect(() => {
    if (!user) return;

    const fetchProfile = async () => {
      try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setDashboardTitle(data.dashboardTitle || 'My Decks');
          setDashboardDescription(data.dashboardDescription || 'Manage your study materials and track your progress.');
        } else {
          // Create initial profile
          await setDoc(doc(db, 'users', user.uid), sanitizeData({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
            dashboardTitle: 'My Decks',
            dashboardDescription: 'Manage your study materials and track your progress.',
            role: 'user'
          }));
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      }
    };

    fetchProfile();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const updateDashboardProfile = async (title: string, desc: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), sanitizeData({
        dashboardTitle: title,
        dashboardDescription: desc
      }));
      setDashboardTitle(title);
      setDashboardDescription(desc);
      setIsEditingDashboard(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handleSendMessage = async () => {
    if (!userInput.trim() || isChatting) return;

    const newMessage = { role: 'user' as const, text: userInput };
    setChatMessages(prev => [...prev, newMessage]);
    setUserInput('');
    setIsChatting(true);

    try {
      const history = chatMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));
      
      const response = await chatWithAssistant(userInput, history);
      
      // Check if response contains a deck creation JSON
      const jsonMatch = response.match(/\{[\s\S]*"type":\s*"create_deck"[\s\S]*\}/);
      
      if (jsonMatch) {
        try {
          const deckData = JSON.parse(jsonMatch[0]);
          const newDeckData = {
            userId: user?.uid || 'anonymous',
            title: deckData.title,
            description: deckData.description,
            subject: selectedSubject,
            topic: selectedTopic !== 'All Topics' ? selectedTopic : SYLLABUS[selectedSubject][0],
            cards: deckData.cards.map((c: any) => ({
              id: crypto.randomUUID(),
              question: c.question,
              answer: c.answer,
              mastered: false,
              type: 'theory'
            })),
            createdAt: Date.now(),
          };

          if (user) {
            await addDoc(collection(db, 'decks'), sanitizeData(newDeckData));
          } else {
            setDecks(prev => [{ ...newDeckData, id: crypto.randomUUID() } as Deck, ...prev]);
          }
          setChatMessages(prev => [...prev, { role: 'model', text: `Great! I've created the deck "${deckData.title}" for you with ${deckData.cards.length} cards. ${user ? 'It has been saved to your account.' : 'You can find it on your dashboard (Login to save permanently).'}` }]);
        } catch (e) {
          setChatMessages(prev => [...prev, { role: 'model', text: response }]);
        }
      } else {
        setChatMessages(prev => [...prev, { role: 'model', text: response }]);
      }
    } catch (error) {
      console.error(error);
      setChatMessages(prev => [...prev, { role: 'model', text: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsChatting(false);
    }
  };

  const filteredDecks = useMemo(() => 
    decks.filter(d => {
      const matchesSearch = d.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesSubject = (d.subject || 'Biology') === selectedSubject;
      const matchesTopic = d.topic === selectedTopic;
      return matchesSearch && matchesSubject && matchesTopic;
    })
  , [decks, searchQuery, selectedSubject, selectedTopic]);

  const getTopicMastery = (subject: string, topic: string) => {
    const topicDecks = decks.filter(d => (d.subject || 'Biology') === subject && d.topic === topic);
    const allCards = topicDecks.flatMap(d => d.cards);
    if (allCards.length === 0) return 0;
    const masteredCards = allCards.filter(c => c.mastered).length;
    return Math.round((masteredCards / allCards.length) * 100);
  };

  const allCardsOfTopic = useMemo(() => 
    filteredDecks.flatMap(d => d.cards.map(c => ({ ...c, type: c.type || 'theory' })))
  , [filteredDecks]);

  const allTheoryCards = useMemo(() => 
    decks.flatMap(d => d.cards.filter(c => (c.type || 'theory') === 'theory'))
  , [decks]);

  const allQuestionCards = useMemo(() => 
    decks.flatMap(d => d.cards.filter(c => c.type === 'question'))
  , [decks]);

  const studyCards = useMemo(() => {
    let cards = allCardsOfTopic;
    if (studyType !== 'all') {
      cards = cards.filter(c => c.type === studyType);
    }
    if (studyFilter === 'all') return cards;
    if (studyFilter === 'unmastered') return cards.filter(c => !c.mastered);
    return cards.filter(c => c.mastered);
  }, [allCardsOfTopic, studyFilter, studyType]);

  const totalProgress = useMemo(() => {
    const allCards = decks.flatMap(d => d.cards);
    if (allCards.length === 0) return 0;
    const mastered = allCards.filter(c => c.mastered).length;
    return Math.round((mastered / allCards.length) * 100);
  }, [decks]);

  const handleAddCard = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    const formData = new FormData(e.currentTarget);
    const question = formData.get('question') as string;
    const answer = formData.get('answer') as string;
    const type = formData.get('type') as 'theory' | 'question';
    
    const options = type === 'question' ? [
      formData.get('opt1') as string,
      formData.get('opt2') as string,
      formData.get('opt3') as string,
      formData.get('opt4') as string,
    ].filter(Boolean) : undefined;

    try {
      if (editingCard) {
        const deckToUpdate = decks.find(d => d.cards.some(c => c.id === editingCard.id));
        if (deckToUpdate) {
          const updatedCards = deckToUpdate.cards.map(c => 
            c.id === editingCard.id ? { ...c, question, answer, type, options } : c
          );
          if (user) {
            await updateDoc(doc(db, 'decks', deckToUpdate.id), sanitizeData({ cards: updatedCards }));
            // Update in global collection too (this is a bit complex as we need the global card ID)
            // For now, we'll just focus on new additions for global collections
          } else {
            setDecks(decks.map(d => d.id === deckToUpdate.id ? { ...d, cards: updatedCards } : d));
          }
        }
      } else {
        const newCard: Flashcard = {
          id: crypto.randomUUID(),
          question,
          answer,
          mastered: false,
          type,
          options,
        };
        
        const existingDeck = decks.find(d => d.topic === selectedTopic && (d.subject || 'Biology') === selectedSubject);
        if (existingDeck) {
          const updatedCards = [...existingDeck.cards, newCard];
          if (user) {
            await updateDoc(doc(db, 'decks', existingDeck.id), sanitizeData({ cards: updatedCards }));
            await saveCardsToGlobalDatabase([newCard], selectedSubject, selectedTopic);
          } else {
            setDecks(decks.map(d => d.id === existingDeck.id ? { ...d, cards: updatedCards } : d));
          }
        } else {
          const newDeckData = {
            userId: user?.uid || 'anonymous',
            title: selectedTopic,
            description: `Study cards for ${selectedTopic}`,
            subject: selectedSubject,
            topic: selectedTopic,
            cards: [newCard],
            createdAt: Date.now(),
          };
          if (user) {
            await addDoc(collection(db, 'decks'), sanitizeData(newDeckData));
            await saveCardsToGlobalDatabase([newCard], selectedSubject, selectedTopic);
          } else {
            setDecks([{ ...newDeckData, id: crypto.randomUUID() } as Deck, ...decks]);
          }
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'decks');
    }
    
    setIsCardModalOpen(false);
    setEditingCard(null);
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      const deckToUpdate = decks.find(d => d.cards.some(c => c.id === cardId));
      if (deckToUpdate) {
        const updatedCards = deckToUpdate.cards.filter(c => c.id !== cardId);
        if (user) {
          await updateDoc(doc(db, 'decks', deckToUpdate.id), sanitizeData({ cards: updatedCards }));
        } else {
          setDecks(decks.map(d => d.id === deckToUpdate.id ? { ...d, cards: updatedCards } : d));
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'decks');
    }
  };

  const handleToggleMastery = async (cardId: string) => {
    try {
      const deckToUpdate = decks.find(d => d.cards.some(c => c.id === cardId));
      if (deckToUpdate) {
        const updatedCards = deckToUpdate.cards.map(c => 
          c.id === cardId ? { ...c, mastered: !c.mastered } : c
        );
        if (user) {
          await updateDoc(doc(db, 'decks', deckToUpdate.id), sanitizeData({ cards: updatedCards }));
        } else {
          setDecks(decks.map(d => d.id === deckToUpdate.id ? { ...d, cards: updatedCards } : d));
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'decks');
    }
  };

  const saveCardsToGlobalDatabase = async (cards: Flashcard[], subject: string, topic: string) => {
    if (!user) return;
    
    const batch = [];
    for (const card of cards) {
      const collectionName = card.type === 'question' ? 'questions' : 'theory';
      const cardData = {
        ...card,
        userId: user.uid,
        subject,
        topic,
        createdAt: Date.now(),
      };
      batch.push(addDoc(collection(db, collectionName), sanitizeData(cardData)));
    }
    await Promise.all(batch);
  };

  const handleAIGenerate = async () => {
    if (!aiTopic) return;
    setIsGenerating(true);
    try {
      const generated = await generateFlashcards(aiTopic);
      const newCards: Flashcard[] = generated.map((g: any) => ({
        id: crypto.randomUUID(),
        question: g.question,
        answer: g.answer,
        mastered: false,
        type: g.type || 'question',
        options: g.options,
      }));
      
      const existingDeck = decks.find(d => d.topic === selectedTopic && (d.subject || 'Biology') === selectedSubject);
      if (existingDeck) {
        const updatedCards = [...existingDeck.cards, ...newCards];
        if (user) {
          await updateDoc(doc(db, 'decks', existingDeck.id), sanitizeData({ cards: updatedCards }));
          await saveCardsToGlobalDatabase(newCards, selectedSubject, selectedTopic);
        } else {
          setDecks(decks.map(d => d.id === existingDeck.id ? { ...d, cards: updatedCards } : d));
        }
      } else {
        const newDeckData = {
          userId: user?.uid || 'anonymous',
          title: selectedTopic,
          description: `Study cards for ${selectedTopic}`,
          subject: selectedSubject,
          topic: selectedTopic,
          cards: newCards,
          createdAt: Date.now(),
        };
        if (user) {
          await addDoc(collection(db, 'decks'), sanitizeData(newDeckData));
          await saveCardsToGlobalDatabase(newCards, selectedSubject, selectedTopic);
        } else {
          setDecks([{ ...newDeckData, id: crypto.randomUUID() } as Deck, ...decks]);
        }
      }
      setIsAIModalOpen(false);
      setAiTopic('');
    } catch (error) {
      console.error(error);
      handleFirestoreError(error, OperationType.WRITE, 'decks');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileUpload = async () => {
    if (!uploadFile) return;
    setIsUploading(true);
    try {
      const reader = new FileReader();
      const fileContent = await new Promise<string>((resolve, reject) => {
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (e) => reject(e);
        reader.readAsText(uploadFile);
      });

      const generated = await analyzeDocumentAndGenerateCards(fileContent, SYLLABUS);
      
      const cardsByTopic: Record<string, Record<string, Flashcard[]>> = {};
      generated.forEach((g: any) => {
        const subject = g.subject;
        const subtopic = g.subtopic;
        if (!cardsByTopic[subject]) cardsByTopic[subject] = {};
        if (!cardsByTopic[subject][subtopic]) cardsByTopic[subject][subtopic] = [];
        cardsByTopic[subject][subtopic].push({
          id: crypto.randomUUID(),
          question: g.question,
          answer: g.answer,
          mastered: false,
          type: g.type || 'theory',
          options: g.options,
        });
      });

      for (const [subject, subtopics] of Object.entries(cardsByTopic)) {
        for (const [subtopic, newCards] of Object.entries(subtopics)) {
          const existingDeck = decks.find(d => d.topic === subtopic && (d.subject || 'Biology') === subject);
          if (existingDeck) {
            const updatedCards = [...existingDeck.cards, ...newCards];
            if (user) {
              await updateDoc(doc(db, 'decks', existingDeck.id), sanitizeData({ cards: updatedCards }));
              await saveCardsToGlobalDatabase(newCards, subject, subtopic);
            } else {
              setDecks(prev => prev.map(d => d.id === existingDeck.id ? { ...d, cards: updatedCards } : d));
            }
          } else {
            const newDeckData = {
              userId: user?.uid || 'anonymous',
              title: subtopic,
              description: `Study cards for ${subtopic} (from document)`,
              subject: subject as any,
              topic: subtopic,
              cards: newCards,
              createdAt: Date.now(),
            };
            if (user) {
              await addDoc(collection(db, 'decks'), sanitizeData(newDeckData));
              await saveCardsToGlobalDatabase(newCards, subject, subtopic);
            } else {
              setDecks(prev => [{ ...newDeckData, id: crypto.randomUUID() } as Deck, ...prev]);
            }
          }
        }
      }

      setIsUploadModalOpen(false);
      setUploadFile(null);
    } catch (error) {
      console.error(error);
      handleFirestoreError(error, OperationType.WRITE, 'decks');
    } finally {
      setIsUploading(false);
    }
  };

  const seedSampleData = async () => {
    if (!user) {
      alert('Please sign in to seed sample data to your database.');
      return;
    }
    
    setIsUploading(true);
    try {
      const sampleContent = `
Subject: Biology
Topic: Cell Structure and Function
Theory: The cell is the basic structural, functional, and biological unit of all known organisms. A cell is the smallest unit of life. Cells are often called the "building blocks of life".
Question: What is the powerhouse of the cell?
Answer: Mitochondria
Options: Nucleus, Mitochondria, Ribosome, Lysosome

Subject: Physics
Topic: Laws of Motion
Theory: Newton's First Law of Motion states that an object at rest stays at rest and an object in motion stays in motion with the same speed and in the same direction unless acted upon by an unbalanced force.
Question: Which law of motion is also known as the Law of Inertia?
Answer: Newton's First Law
Options: First Law, Second Law, Third Law, Law of Gravitation
      `;

      const generated = await analyzeDocumentAndGenerateCards(sampleContent, SYLLABUS);
      
      const cardsByTopic: Record<string, Record<string, Flashcard[]>> = {};
      generated.forEach((g: any) => {
        const subject = g.subject;
        const subtopic = g.subtopic;
        if (!cardsByTopic[subject]) cardsByTopic[subject] = {};
        if (!cardsByTopic[subject][subtopic]) cardsByTopic[subject][subtopic] = [];
        cardsByTopic[subject][subtopic].push({
          id: crypto.randomUUID(),
          question: g.question,
          answer: g.answer,
          mastered: false,
          type: g.type || 'theory',
          options: g.options,
        });
      });

      for (const [subject, subtopics] of Object.entries(cardsByTopic)) {
        for (const [subtopic, newCards] of Object.entries(subtopics)) {
          const existingDeck = decks.find(d => d.topic === subtopic && (d.subject || 'Biology') === subject);
          if (existingDeck) {
            const updatedCards = [...existingDeck.cards, ...newCards];
            await updateDoc(doc(db, 'decks', existingDeck.id), sanitizeData({ cards: updatedCards }));
            await saveCardsToGlobalDatabase(newCards, subject, subtopic);
          } else {
            const newDeckData = {
              userId: user.uid,
              title: subtopic,
              description: `Study cards for ${subtopic} (Sample Data)`,
              subject: subject as any,
              topic: subtopic,
              cards: newCards,
              createdAt: Date.now(),
            };
            await addDoc(collection(db, 'decks'), sanitizeData(newDeckData));
            await saveCardsToGlobalDatabase(newCards, subject, subtopic);
          }
        }
      }
      alert('Sample database for Theory and Question Bank has been created successfully!');
    } catch (error) {
      console.error(error);
      handleFirestoreError(error, OperationType.WRITE, 'decks');
    } finally {
      setIsUploading(false);
    }
  };

  const startStudy = (filter: StudyFilter = 'all', type: 'all' | 'theory' | 'question' = 'all') => {
    setStudyFilter(filter);
    setStudyType(type);
    setCurrentCardIndex(0);
    setIsFlipped(false);
    setIsStudying(true);
  };

  const nextCard = () => {
    if (currentCardIndex < studyCards.length - 1) {
      setCurrentCardIndex(prev => prev + 1);
      setIsFlipped(false);
    } else {
      setIsStudying(false);
    }
  };

  const prevCard = () => {
    if (currentCardIndex > 0) {
      setCurrentCardIndex(prev => prev - 1);
      setIsFlipped(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fafafa] text-slate-900 font-sans selection:bg-teal-100 selection:text-teal-900">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setIsStudying(false); }}>
            <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-teal-200">
              <Brain className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
              Target Neet 2027
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder="Search decks..." 
                className="pl-10 w-64 bg-slate-50 border-slate-200 focus:bg-white transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <div className="flex flex-col items-center gap-1 py-1">
              <Sheet open={isAssistantOpen} onOpenChange={setIsAssistantOpen}>
                <SheetTrigger
                  render={
                    <Button size="sm" className="bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-100 h-8 px-3 text-xs">
                      <Mic className="w-3 h-3 mr-1.5" />
                      Jarvis
                    </Button>
                  }
                />
                <SheetContent className="sm:max-w-md flex flex-col h-full p-0">
                  <SheetHeader className="p-6 border-b">
                    <SheetTitle className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-teal-600" />
                      Jarvis AI
                    </SheetTitle>
                    <SheetDescription>
                      Talk to Jarvis to create new study cards or get help with your studies.
                    </SheetDescription>
                  </SheetHeader>
                  
                  <div className="flex-grow">
                    <LiveAssistant 
                      onDeckCreated={async (deckData) => {
                        const newDeckData = {
                          userId: user?.uid || 'anonymous',
                          title: deckData.title,
                          description: deckData.description,
                          subject: selectedSubject,
                          topic: selectedTopic,
                          cards: deckData.cards.map((c: any) => ({
                            id: crypto.randomUUID(),
                            question: c.question,
                            answer: c.answer,
                            mastered: false,
                            type: c.type || 'theory',
                          })),
                          createdAt: Date.now(),
                        };
                        
                        if (user) {
                          await addDoc(collection(db, 'decks'), sanitizeData(newDeckData));
                        } else {
                          setDecks(prev => [{ ...newDeckData, id: crypto.randomUUID() } as Deck, ...prev]);
                        }
                        setIsAssistantOpen(false);
                      }} 
                    />
                  </div>
                </SheetContent>
              </Sheet>

              <Button 
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px] font-bold uppercase tracking-tighter text-slate-400 hover:text-teal-600 transition-all"
                onClick={() => {
                  window.open('https://www.youtube.com/results?search_query=motivational+study+music+for+neet', '_blank');
                }}
              >
                <Music className="w-3 h-3 mr-1" />
                Music
              </Button>

              <Dialog open={isUploadModalOpen} onOpenChange={setIsUploadModalOpen}>
                <DialogTrigger
                  render={
                    <Button 
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px] font-bold uppercase tracking-tighter text-slate-400 hover:text-teal-600 transition-all"
                    />
                  }
                >
                  <FileUp className="w-3 h-3 mr-1" />
                  Upload
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Upload Study Document</DialogTitle>
                    <DialogDescription>
                      Upload a text or markdown file to generate flashcards from its content.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="fileUpload">Select File</Label>
                      <Input 
                        id="fileUpload" 
                        type="file"
                        accept=".txt,.md,.json"
                        onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsUploadModalOpen(false)}>Cancel</Button>
                    <Button 
                      onClick={handleFileUpload} 
                      disabled={!uploadFile || isUploading}
                      className="bg-teal-600 hover:bg-teal-700"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : 'Generate Cards'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Separator orientation="vertical" className="h-4 mx-1" />

              {isAuthReady && (
                user ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="rounded-full overflow-hidden border border-slate-200" />} >
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={user.displayName || 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <User className="w-4 h-4 text-slate-500" />
                      )}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                          <p className="text-sm font-medium leading-none">{user.displayName}</p>
                          <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                        Log out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button size="sm" variant="outline" onClick={handleLogin} className="h-8 text-xs border-teal-200 text-teal-600 hover:bg-teal-50">
                    Sign In
                  </Button>
                )
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {!isStudying ? (
          /* Dashboard */
          <div className="space-y-8">
            <div className="flex flex-col gap-1 group relative">
              {isEditingDashboard ? (
                <div className="space-y-3 bg-white p-4 rounded-2xl border border-teal-100 shadow-sm">
                  <div className="space-y-1">
                    <Label htmlFor="dashTitle" className="text-xs font-bold text-teal-600 uppercase tracking-wider">Title</Label>
                    <Input 
                      id="dashTitle"
                      value={dashboardTitle}
                      onChange={(e) => setDashboardTitle(e.target.value)}
                      className="text-2xl font-bold h-12"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dashDesc" className="text-xs font-bold text-teal-600 uppercase tracking-wider">Description</Label>
                    <Textarea 
                      id="dashDesc"
                      value={dashboardDescription}
                      onChange={(e) => setDashboardDescription(e.target.value)}
                      className="text-slate-500 min-h-[80px]"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={() => updateDashboardProfile(dashboardTitle, dashboardDescription)} className="bg-teal-600 hover:bg-teal-700">
                      Save Changes
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900">{dashboardTitle}</h2>
                    <p className="text-slate-500">{dashboardDescription}</p>
                  </div>
                  <div className="flex gap-2">
                    {user && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="opacity-0 group-hover:opacity-100 transition-opacity border-teal-200 text-teal-600 hover:bg-teal-50"
                        onClick={seedSampleData}
                        disabled={isUploading}
                      >
                        {isUploading ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : <Sparkles className="w-3 h-3 mr-2" />}
                        Seed Sample Database
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-teal-600 hover:bg-teal-50"
                      onClick={() => setIsEditingDashboard(true)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <Tabs value={selectedSubject} onValueChange={(v) => {
                setSelectedSubject(v as any);
                setSelectedTopic(SYLLABUS[v as any][0]);
              }} className="w-full">
                <TabsList className="bg-white border border-slate-200 p-1 rounded-2xl h-14 w-full md:w-auto">
                  <TabsTrigger value="Biology" className="rounded-xl px-8 h-12 data-[state=active]:bg-teal-600 data-[state=active]:text-white">Biology</TabsTrigger>
                  <TabsTrigger value="Physics" className="rounded-xl px-8 h-12 data-[state=active]:bg-teal-600 data-[state=active]:text-white">Physics</TabsTrigger>
                  <TabsTrigger value="Chemistry" className="rounded-xl px-8 h-12 data-[state=active]:bg-teal-600 data-[state=active]:text-white">Chemistry</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex flex-col lg:flex-row gap-8">
                {/* Sidebar: Subtopics with Progress */}
                <div className="w-full lg:w-80 shrink-0 space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest px-2">Library</h3>
                    <div className="space-y-2">
                      <button 
                        onClick={() => setViewMode('database')}
                        className={cn(
                          "w-full text-left p-3 rounded-xl transition-all group border flex items-center gap-3",
                          viewMode === 'database' 
                            ? "bg-teal-600 border-teal-600 text-white shadow-lg shadow-teal-100" 
                            : "bg-white border-slate-100 text-slate-600 hover:border-teal-200 hover:bg-teal-50/30"
                        )}
                      >
                        <div className={cn("p-2 rounded-lg", viewMode === 'database' ? "bg-teal-500" : "bg-teal-50")}>
                          <BookOpen className={cn("w-4 h-4", viewMode === 'database' ? "text-white" : "text-teal-600")} />
                        </div>
                        <span className="text-sm font-semibold">Database Folder</span>
                      </button>

                      <button 
                        onClick={() => setViewMode('progress')}
                        className={cn(
                          "w-full text-left p-3 rounded-xl transition-all group border flex items-center gap-3",
                          viewMode === 'progress' 
                            ? "bg-teal-600 border-teal-600 text-white shadow-lg shadow-teal-100" 
                            : "bg-white border-slate-100 text-slate-600 hover:border-teal-200 hover:bg-teal-50/30"
                        )}
                      >
                        <div className={cn("p-2 rounded-lg", viewMode === 'progress' ? "bg-teal-500" : "bg-teal-50")}>
                          <TrendingUp className={cn("w-4 h-4", viewMode === 'progress' ? "text-white" : "text-teal-600")} />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold">Progress Analytics</span>
                          <span className={cn("text-[10px]", viewMode === 'progress' ? "text-teal-100" : "text-teal-500")}>{totalProgress}% Mastered</span>
                        </div>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-2 px-2">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Syllabus</h3>
                    </div>
                    <ScrollArea className="h-[600px] pr-4">
                      <div className="space-y-2">
                        {SYLLABUS[selectedSubject].map((topic) => {
                          const mastery = getTopicMastery(selectedSubject, topic);
                          const isActive = viewMode === 'syllabus' && selectedTopic === topic;
                          
                          return (
                            <button 
                              key={topic}
                              onClick={() => {
                                setViewMode('syllabus');
                                setSelectedTopic(topic);
                              }}
                              className={cn(
                                "w-full text-left p-3 rounded-xl transition-all group border",
                                isActive 
                                  ? "bg-teal-600 border-teal-600 text-white shadow-lg shadow-teal-100" 
                                  : "bg-white border-slate-100 text-slate-600 hover:border-teal-200 hover:bg-teal-50/30"
                              )}
                            >
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-semibold truncate pr-2">{topic}</span>
                                <span className={cn("text-[10px] font-bold", isActive ? "text-teal-100" : "text-teal-600")}>
                                  {mastery}%
                                </span>
                              </div>
                              {/* "Gantt" style progress bar */}
                              <div className={cn("h-1.5 rounded-full overflow-hidden", isActive ? "bg-teal-700" : "bg-slate-100")}>
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${mastery}%` }}
                                  className={cn("h-full", isActive ? "bg-white" : "bg-teal-500")}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

              {/* Main Content: Cards */}
              <div className="flex-grow space-y-6">
                {viewMode === 'database' ? (
                  /* Database View */
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <h2 className="text-2xl font-bold text-slate-900">Database Folder</h2>
                        <Badge variant="secondary" className="bg-teal-50 text-teal-700">
                          {allTheoryCards.length + allQuestionCards.length} Total Items
                        </Badge>
                      </div>
                    </div>

                    <Tabs defaultValue="theory-total" className="w-full">
                      <TabsList className="bg-slate-100 p-1 rounded-xl mb-6">
                        <TabsTrigger value="theory-total" className="rounded-lg px-8">Theory Total ({allTheoryCards.length})</TabsTrigger>
                        <TabsTrigger value="question-bank" className="rounded-lg px-8">Question Bank ({allQuestionCards.length})</TabsTrigger>
                      </TabsList>

                      <TabsContent value="theory-total" className="mt-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {allTheoryCards.map((card) => (
                            <Card key={card.id} className="group border-slate-200 hover:border-teal-200 transition-all">
                              <CardContent className="p-4">
                                <div className="flex justify-between items-start gap-4">
                                  <div className="space-y-1">
                                    <p className="text-sm font-medium text-slate-900">{card.question}</p>
                                    <p className="text-xs text-slate-500 line-clamp-2">{card.answer}</p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                          {allTheoryCards.length === 0 && (
                            <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-slate-200">
                              <p className="text-slate-500">No theory cards in the database yet.</p>
                            </div>
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="question-bank" className="mt-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {allQuestionCards.map((card) => (
                            <Card key={card.id} className="group border-slate-200 hover:border-teal-200 transition-all">
                              <CardContent className="p-4">
                                <div className="flex justify-between items-start gap-4">
                                  <div className="space-y-2 flex-grow">
                                    <p className="text-sm font-medium text-slate-900">{card.question}</p>
                                    {card.options && card.options.length > 0 && (
                                      <div className="grid grid-cols-2 gap-1.5 mt-2">
                                        {card.options.map((option, idx) => (
                                          <div key={idx} className="text-[10px] px-2 py-1 bg-slate-50 rounded border border-slate-100 text-slate-600 truncate">
                                            {String.fromCharCode(65 + idx)}. {option}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <p className="text-xs text-slate-500 line-clamp-2 mt-2">Ans: {card.answer}</p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                          {allQuestionCards.length === 0 && (
                            <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-slate-200">
                              <p className="text-slate-500">No questions in the question bank yet.</p>
                            </div>
                          )}
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                ) : viewMode === 'progress' ? (
                  /* Progress View */
                  <div className="space-y-8">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <h2 className="text-2xl font-bold text-slate-900">Progress Analytics</h2>
                        <Badge variant="secondary" className="bg-teal-50 text-teal-700">
                          Overall Mastery: {totalProgress}%
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <Card className="border-teal-100 bg-teal-50/30 md:col-span-2">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2 text-teal-900">
                            <BarChart2 className="w-5 h-5 text-teal-600" />
                            Total Learning Progress
                          </CardTitle>
                          <CardDescription>Your overall performance across all subjects and topics.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm font-medium">
                              <span className="text-slate-600">Mastered Cards</span>
                              <span className="text-teal-700">{decks.flatMap(d => d.cards).filter(c => c.mastered).length} / {decks.flatMap(d => d.cards).length}</span>
                            </div>
                            <Progress value={totalProgress} className="h-3 bg-teal-100" />
                          </div>

                          <div className="grid grid-cols-3 gap-4 pt-4 border-t border-teal-100">
                            <div className="text-center">
                              <p className="text-2xl font-bold text-teal-700">{decks.length}</p>
                              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Total Decks</p>
                            </div>
                            <div className="text-center">
                              <p className="text-2xl font-bold text-teal-700">{decks.flatMap(d => d.cards).length}</p>
                              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Total Cards</p>
                            </div>
                            <div className="text-center">
                              <p className="text-2xl font-bold text-teal-700">{decks.flatMap(d => d.cards).filter(c => c.mastered).length}</p>
                              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Mastered</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-slate-200">
                        <CardHeader>
                          <CardTitle className="text-lg text-slate-900">Subject Breakdown</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {['Biology', 'Physics', 'Chemistry'].map(subject => {
                            const subjectDecks = decks.filter(d => (d.subject || 'Biology') === subject);
                            const allCards = subjectDecks.flatMap(d => d.cards);
                            const mastered = allCards.filter(c => c.mastered).length;
                            const percent = allCards.length > 0 ? Math.round((mastered / allCards.length) * 100) : 0;
                            
                            return (
                              <div key={subject} className="space-y-1.5">
                                <div className="flex justify-between text-xs font-semibold">
                                  <span className="text-slate-600">{subject}</span>
                                  <span className="text-teal-600">{percent}%</span>
                                </div>
                                <Progress value={percent} className="h-1.5" />
                              </div>
                            );
                          })}
                        </CardContent>
                      </Card>
                    </div>

                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <FileUp className="w-5 h-5 text-slate-400" />
                        Practice Paper Wise Progress
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {decks.length === 0 ? (
                          <div className="col-span-full py-12 text-center bg-white rounded-2xl border-2 border-dashed border-slate-100">
                            <p className="text-slate-400">No practice papers uploaded yet.</p>
                          </div>
                        ) : (
                          decks.map(deck => {
                            const mastered = deck.cards.filter(c => c.mastered).length;
                            const total = deck.cards.length;
                            const percent = total > 0 ? Math.round((mastered / total) * 100) : 0;
                            
                            return (
                              <Card key={deck.id} className="group border-slate-200 hover:border-teal-200 transition-all hover:shadow-md">
                                <CardContent className="p-4 space-y-3">
                                  <div className="flex justify-between items-start">
                                    <div className="space-y-0.5">
                                      <h4 className="font-semibold text-slate-900 group-hover:text-teal-600 transition-colors line-clamp-1">{deck.title}</h4>
                                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{deck.subject} • {deck.topic}</p>
                                    </div>
                                    <Badge variant="outline" className="text-teal-600 border-teal-200 bg-teal-50/50">
                                      {percent}%
                                    </Badge>
                                  </div>
                                  <Progress value={percent} className="h-2" />
                                  <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                                    <span>{mastered} Mastered</span>
                                    <span>{total} Total Cards</span>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Topic View */
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <h2 className="text-2xl font-bold text-slate-900">{selectedTopic}</h2>
                        <Badge variant="secondary" className="bg-teal-50 text-teal-700">
                          {allCardsOfTopic.length} Cards
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          onClick={() => startStudy('all', 'all')}
                          disabled={allCardsOfTopic.length === 0}
                          className="border-teal-200 text-teal-600 hover:bg-teal-50"
                        >
                          <Play className="w-4 h-4 mr-2" />
                          Study All
                        </Button>
                        <Dialog open={isAIModalOpen} onOpenChange={setIsAIModalOpen}>
                          <DialogTrigger
                            render={
                              <Button size="sm" variant="outline" className="border-teal-200 text-teal-600 hover:bg-teal-50" />
                            }
                          >
                            <Sparkles className="w-4 h-4 mr-2" />
                            AI Generate
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Generate with AI</DialogTitle>
                              <DialogDescription>
                                Enter a topic and Gemini will create a set of flashcards for you.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                              <div className="grid gap-2">
                                <Label htmlFor="aiTopic">Topic or Subject</Label>
                                <Input 
                                  id="aiTopic" 
                                  placeholder="e.g. Quantum Physics basics, French verbs..." 
                                  value={aiTopic}
                                  onChange={(e) => setAiTopic(e.target.value)}
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button onClick={handleAIGenerate} disabled={isGenerating || !aiTopic}>
                                {isGenerating ? 'Generating...' : 'Generate Cards'}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>

                {allCardsOfTopic.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                      <BookOpen className="w-8 h-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900">No cards found</h3>
                    <p className="text-slate-500 mb-6">Talk to Jarvis to create your first study cards for this topic.</p>
                    <Button onClick={() => setIsAssistantOpen(true)} variant="outline">
                      <Mic className="w-4 h-4 mr-2" />
                      Talk to Jarvis
                    </Button>
                  </div>
                ) : (
                  <Tabs defaultValue="theory" className="w-full">
                    <TabsList className="bg-slate-100 p-1 rounded-xl mb-6">
                      <TabsTrigger value="theory" className="rounded-lg px-8">Theory</TabsTrigger>
                      <TabsTrigger value="question" className="rounded-lg px-8">Questions</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="theory" className="mt-0">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Theory Concepts</h3>
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => {
                              setEditingCard(null);
                              setFormCardType('theory');
                              setIsCardModalOpen(true);
                            }}
                            className="text-teal-600 hover:bg-teal-50"
                          >
                            <Plus className="w-3 h-3 mr-2" />
                            Add Theory
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => {
                              startStudy('all', 'theory');
                            }}
                            disabled={allCardsOfTopic.filter(c => c.type === 'theory').length === 0}
                            className="text-teal-600 hover:bg-teal-50"
                          >
                            <Play className="w-3 h-3 mr-2" />
                            Study Theory
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {allCardsOfTopic.filter(c => c.type === 'theory').map((card) => (
                          <Card key={card.id} className="group border-slate-200 hover:border-teal-200 transition-all">
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start gap-4">
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-slate-900">{card.question}</p>
                                  <p className="text-xs text-slate-500 line-clamp-2">{card.answer}</p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className={cn("h-8 w-8 rounded-full", card.mastered ? "text-green-600 bg-green-50" : "text-slate-300 hover:text-green-600 hover:bg-green-50")}
                                    onClick={() => handleToggleMastery(card.id)}
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:text-teal-600 hover:bg-teal-50" onClick={() => { setEditingCard(card); setFormCardType(card.type || 'theory'); setIsCardModalOpen(true); }}>
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteCard(card.id)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                        {allCardsOfTopic.filter(c => c.type === 'theory').length === 0 && (
                          <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-slate-200">
                            <p className="text-slate-500">No theory cards for this topic yet.</p>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="question" className="mt-0">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Practice Questions</h3>
                        <div className="flex gap-2">
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => {
                              setEditingCard(null);
                              setFormCardType('question');
                              setIsCardModalOpen(true);
                            }}
                            className="text-teal-600 hover:bg-teal-50"
                          >
                            <Plus className="w-3 h-3 mr-2" />
                            Add Question
                          </Button>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => {
                              startStudy('all', 'question');
                            }}
                            disabled={allCardsOfTopic.filter(c => c.type === 'question').length === 0}
                            className="text-teal-600 hover:bg-teal-50"
                          >
                            <Play className="w-3 h-3 mr-2" />
                            Study Questions
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {allCardsOfTopic.filter(c => c.type === 'question').map((card) => (
                          <Card key={card.id} className="group border-slate-200 hover:border-teal-200 transition-all">
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start gap-4">
                                <div className="space-y-2 flex-grow">
                                  <p className="text-sm font-medium text-slate-900">{card.question}</p>
                                  {card.options && card.options.length > 0 && (
                                    <div className="grid grid-cols-2 gap-1.5 mt-2">
                                      {card.options.map((option, idx) => (
                                        <div key={idx} className="text-[10px] px-2 py-1 bg-slate-50 rounded border border-slate-100 text-slate-600 truncate">
                                          {String.fromCharCode(65 + idx)}. {option}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <p className="text-xs text-slate-500 line-clamp-2 mt-2">Ans: {card.answer}</p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className={cn("h-8 w-8 rounded-full", card.mastered ? "text-green-600 bg-green-50" : "text-slate-300 hover:text-green-600 hover:bg-green-50")}
                                    onClick={() => handleToggleMastery(card.id)}
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:text-teal-600 hover:bg-teal-50" onClick={() => { setEditingCard(card); setFormCardType(card.type || 'question'); setIsCardModalOpen(true); }}>
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-slate-300 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteCard(card.id)}>
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                        {allCardsOfTopic.filter(c => c.type === 'question').length === 0 && (
                          <div className="col-span-full py-12 text-center bg-white rounded-2xl border border-slate-200">
                            <p className="text-slate-500">No question cards for this topic yet.</p>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  ) : (
          /* Study Mode */
          <div className="fixed inset-0 bg-slate-950 z-50 flex flex-col overflow-hidden">
            {/* Slideshow Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md">
              <Button 
                variant="ghost" 
                onClick={() => setIsStudying(false)} 
                className="text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4 mr-2" />
                Exit Slideshow
              </Button>
              
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  {selectedTopic}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-300">
                    {currentCardIndex + 1} <span className="text-slate-600">/</span> {studyCards.length}
                  </span>
                </div>
              </div>

              <div className="w-32 hidden md:block">
                <Progress value={((currentCardIndex + 1) / studyCards.length) * 100} className="h-1.5 bg-slate-800" />
              </div>
            </div>

            {/* Slideshow Content */}
            <div className="flex-grow flex items-center justify-center p-4 md:p-8 relative">
              {/* Side Navigation - Desktop */}
              <div className="absolute left-4 md:left-12 hidden md:block">
                <Button 
                  variant="ghost" 
                  size="lg" 
                  onClick={prevCard} 
                  disabled={currentCardIndex === 0} 
                  className="rounded-full h-16 w-16 text-slate-500 hover:text-white hover:bg-slate-800 disabled:opacity-20"
                >
                  <ChevronLeft className="w-8 h-8" />
                </Button>
              </div>

              <div className="absolute right-4 md:right-12 hidden md:block">
                <Button 
                  variant="ghost" 
                  size="lg" 
                  onClick={nextCard} 
                  disabled={currentCardIndex === studyCards.length - 1}
                  className="rounded-full h-16 w-16 text-slate-500 hover:text-white hover:bg-slate-800 disabled:opacity-20"
                >
                  <ChevronRight className="w-8 h-8" />
                </Button>
              </div>

              <div className="w-full max-w-4xl h-full max-h-[600px] flex items-center justify-center">
                {studyCards.length > 0 ? (
                  <div className="perspective-1000 w-full h-full max-w-2xl">
                    <motion.div
                      key={currentCardIndex}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="relative w-full h-full transition-all duration-500 preserve-3d cursor-pointer"
                      style={{ transformStyle: 'preserve-3d' }}
                    >
                      <motion.div
                        className="w-full h-full relative"
                        animate={{ rotateY: isFlipped ? 180 : 0 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                        onClick={() => setIsFlipped(!isFlipped)}
                      >
                        {/* Front */}
                        <div className="absolute inset-0 backface-hidden">
                          <Card className="w-full h-full flex flex-col items-center justify-center p-8 md:p-16 text-center border-slate-800 shadow-2xl rounded-[2rem] bg-slate-900 text-white overflow-hidden relative group">
                            <div className="absolute inset-0 bg-gradient-to-br from-teal-500/5 to-transparent opacity-50" />
                            <Badge variant="outline" className="absolute top-8 left-8 text-teal-400 border-teal-900/50 bg-teal-900/20 capitalize px-3 py-1">
                              {studyCards[currentCardIndex].type}
                            </Badge>
                            
                            <div className="relative z-10 space-y-8 w-full">
                              <h3 className={cn(
                                "font-bold tracking-tight leading-tight",
                                studyCards[currentCardIndex].options ? "text-2xl md:text-3xl mb-8" : "text-3xl md:text-5xl"
                              )}>
                                {studyCards[currentCardIndex].question}
                              </h3>
                              
                              {studyCards[currentCardIndex].options && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl mx-auto">
                                  {studyCards[currentCardIndex].options.map((option, idx) => (
                                    <div key={idx} className="p-4 rounded-2xl border border-slate-800 bg-slate-800/50 text-slate-300 text-base text-left flex items-center gap-4 hover:border-teal-500/50 transition-colors">
                                      <span className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold shrink-0 text-teal-400">
                                        {String.fromCharCode(65 + idx)}
                                      </span>
                                      {option}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 text-slate-500 text-xs font-medium uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                              <RotateCcw className="w-3 h-3" />
                              Click to reveal answer
                            </div>
                          </Card>
                        </div>

                        {/* Back */}
                        <div className="absolute inset-0 backface-hidden rotate-y-180">
                          <Card className="w-full h-full flex flex-col items-center justify-center p-8 md:p-16 text-center border-teal-900/50 shadow-2xl rounded-[2rem] bg-slate-900 text-white overflow-hidden relative">
                            <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 to-transparent" />
                            <Badge variant="outline" className="absolute top-8 left-8 text-teal-400 border-teal-900/50 bg-teal-900/30 px-3 py-1">Answer</Badge>
                            
                            <div className="relative z-10 space-y-10 w-full">
                              <div className="space-y-4">
                                <p className="text-teal-500 text-xs font-bold uppercase tracking-[0.2em]">Explanation</p>
                                <h3 className="text-3xl md:text-5xl font-medium text-white leading-tight">
                                  {studyCards[currentCardIndex].answer}
                                </h3>
                              </div>

                              <div className="flex justify-center gap-4" onClick={(e) => e.stopPropagation()}>
                                <Button 
                                  variant={studyCards[currentCardIndex].mastered ? "default" : "outline"}
                                  size="lg"
                                  className={cn(
                                    "rounded-full px-8 h-14 text-base font-semibold transition-all",
                                    studyCards[currentCardIndex].mastered 
                                      ? "bg-green-600 hover:bg-green-700 border-transparent" 
                                      : "border-slate-700 text-slate-300 hover:bg-slate-800"
                                  )}
                                  onClick={() => handleToggleMastery(studyCards[currentCardIndex].id)}
                                >
                                  {studyCards[currentCardIndex].mastered ? <CheckCircle2 className="w-5 h-5 mr-2" /> : <XCircle className="w-5 h-5 mr-2" />}
                                  {studyCards[currentCardIndex].mastered ? 'Mastered' : 'Mark as Mastered'}
                                </Button>
                              </div>
                            </div>
                          </Card>
                        </div>
                      </motion.div>
                    </motion.div>
                  </div>
                ) : (
                  <div className="text-center space-y-4">
                    <div className="w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center mx-auto border border-slate-800">
                      <XCircle className="w-10 h-10 text-slate-700" />
                    </div>
                    <h3 className="text-2xl font-bold text-white">No cards to study!</h3>
                    <p className="text-slate-500">Add some cards to this deck first.</p>
                    <Button onClick={() => setIsStudying(false)} variant="outline" className="border-slate-800 text-slate-400">
                      Return to Dashboard
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Slideshow Footer - Mobile Controls */}
            <div className="px-6 py-8 border-t border-slate-800 bg-slate-900/50 backdrop-blur-md flex flex-col items-center gap-6">
              <div className="flex items-center gap-6 md:hidden">
                <Button variant="outline" size="lg" onClick={prevCard} disabled={currentCardIndex === 0} className="rounded-2xl h-14 w-14 p-0 border-slate-700 text-slate-400 bg-slate-800">
                  <ChevronLeft className="w-6 h-6" />
                </Button>
                <Button variant="default" size="lg" onClick={nextCard} disabled={currentCardIndex === studyCards.length - 1} className="rounded-2xl h-14 w-14 p-0 bg-teal-600 hover:bg-teal-700 border-none">
                  <ChevronRight className="w-6 h-6" />
                </Button>
              </div>
              
              <div className="flex items-center gap-3">
                {studyCards.map((_, idx) => (
                  <div 
                    key={idx} 
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300",
                      idx === currentCardIndex ? "w-8 bg-teal-500" : "w-1.5 bg-slate-800"
                    )} 
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <Dialog open={isCardModalOpen} onOpenChange={setIsCardModalOpen}>
        <DialogContent>
          <form onSubmit={handleAddCard}>
            <DialogHeader>
              <DialogTitle>{editingCard ? 'Edit Card' : 'Add New Card'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="type">Card Type</Label>
                <select 
                  id="type" 
                  name="type" 
                  value={formCardType}
                  onChange={(e) => setFormCardType(e.target.value as 'theory' | 'question')}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="theory">Theory</option>
                  <option value="question">Question</option>
                </select>
              </div>
              {formCardType === 'question' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="opt1">Option A</Label>
                    <Input id="opt1" name="opt1" defaultValue={editingCard?.options?.[0]} placeholder="Option A" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="opt2">Option B</Label>
                    <Input id="opt2" name="opt2" defaultValue={editingCard?.options?.[1]} placeholder="Option B" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="opt3">Option C</Label>
                    <Input id="opt3" name="opt3" defaultValue={editingCard?.options?.[2]} placeholder="Option C" required />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="opt4">Option D</Label>
                    <Input id="opt4" name="opt4" defaultValue={editingCard?.options?.[3]} placeholder="Option D" required />
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="question">Question / Concept</Label>
                <Textarea id="question" name="question" defaultValue={editingCard?.question} placeholder="What is the question or concept?" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="answer">Answer / Explanation</Label>
                <Textarea id="answer" name="answer" defaultValue={editingCard?.answer} placeholder="What is the answer or explanation?" required />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit">{editingCard ? 'Save Changes' : 'Add Card'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <style>{`
        .perspective-1000 {
          perspective: 1000px;
        }
        .preserve-3d {
          transform-style: preserve-3d;
        }
        .backface-hidden {
          backface-visibility: hidden;
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
      `}</style>
    </div>
  );
}
