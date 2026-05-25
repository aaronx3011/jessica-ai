import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      '[DB] MONGODB_URI environment variable is not set. ' +
        'Please add it to your .env file.'
    );
  }

  mongoose.set('strictQuery', true);

  try {
    await mongoose.connect(uri);
    console.log('✅ [DB] Connected to MongoDB');
  } catch (error) {
    console.error('❌ [DB] MongoDB connection failed:', error);
    throw error;
  }
}