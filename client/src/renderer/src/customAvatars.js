// Bundles whichever avatar PNGs exist at build time — an empty folder yields an
// empty list, and custom mode then falls back to Discord avatars per speaker.
// Sorted by filename, so avatar-01.png..avatar-10.png define the join order.
const modules = import.meta.glob('./assets/avatars/avatar-*.png', { eager: true, import: 'default' });

export const customAvatars = Object.keys(modules)
  .sort()
  .map((key) => modules[key]);
