import { Document, Packer, Paragraph, TextRun } from 'docx';
import * as mammoth from 'mammoth';

export class DocxUtil {
  static async createDocx(text: string): Promise<Buffer> {
    const lines = text.split('\n');
    const children = lines.map((line) => {
      return new Paragraph({
        children: [
          new TextRun({
            text: line,
            size: 24, // 12pt
          }),
        ],
      });
    });

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: children,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  }

  static async extractText(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }
}
