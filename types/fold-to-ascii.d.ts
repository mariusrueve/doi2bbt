declare module "fold-to-ascii" {
  const ASCIIFolder: {
    foldMaintaining(value?: string): string;
    foldReplacing(value?: string, replacement?: string): string;
  };
  export default ASCIIFolder;
}
