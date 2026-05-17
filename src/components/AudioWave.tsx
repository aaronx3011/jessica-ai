import { motion } from 'motion/react';

export const AudioWave = ({ isPlaying }: { isPlaying: boolean }) => {
  return (
    <div className="flex items-center justify-center h-24 gap-1.5 px-4 md:px-0">
      {[...Array(24)].map((_, i) => (
        <motion.div
          key={i}
          className="w-1.5 md:w-2 rounded-full"
          animate={isPlaying ? {
            height: [20, 80, 40, 100, 30, 60, 20],
            backgroundColor: ['#06b6d4', '#3b82f6', '#22d3ee', '#06b6d4'],
            boxShadow: [
              '0 0 10px rgba(34,211,238,0.4)',
              '0 0 25px rgba(59,130,246,0.6)',
              '0 0 10px rgba(34,211,238,0.4)'
            ]
          } : {
            height: 8,
            backgroundColor: 'rgba(255,255,255,0.05)',
            boxShadow: '0 0 0px transparent'
          }}
          transition={isPlaying ? {
            duration: 1 + Math.random() * 0.8,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.05,
          } : { duration: 0.5 }}
          style={{ height: 8 }}
        />
      ))}
    </div>
  );
};
