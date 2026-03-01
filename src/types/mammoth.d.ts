declare module 'mammoth' {
  export interface ExtractResult {
    value: string;
    messages: any[];
  }

  export interface Options {
    path?: string;
    buffer?: Buffer;
  }

  export function extractRawText(input: Options): Promise<ExtractResult>;
  export function extractHtml(input: Options): Promise<ExtractResult>;
}
