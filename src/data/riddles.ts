import type { AssignmentSlot } from '../lib/starAssignments'

export interface Riddle {
  paragraphs: readonly string[]
  image?: { src: string; alt: string; width: number; height: number }
}

export const RIDDLES: Record<AssignmentSlot, Riddle> = {
  1: {
    paragraphs: [
      'Trois fois mon nom murmuré, et les ombres s’éveillent.\nMais loin des revenants, c’est au ciel que je veille.\nMoi, la rouge, sur l’épaule du chasseur.',
    ],
  },
  2: {
    paragraphs: [
      'Au bord du silence reposent les mots.\nLe vide entre eux recueille l’oubli.\nAucun ne raconte ce qui demeura.',
    ],
  },
  3: {
    paragraphs: ['Un langage ancien demeure dans la pierre,\nVestige d’un peuple devenu lumière.'],
    image: {
      src: 'media/03.png',
      alt: 'Inscription à déchiffrer',
      width: 2814,
      height: 736,
    },
  },
}
