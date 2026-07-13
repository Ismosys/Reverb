/** electron-vite copies `?asset` imports to the output dir and yields a runtime path. */
declare module '*?asset' {
  const src: string
  export default src
}
