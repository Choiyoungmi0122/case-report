import express, { Request, Response } from 'express';
import multer from 'multer';
import { inspectRecordFile, MAX_FILE_BYTES } from '../studyWrite/recordImport';

/**
 * 실험용 Write 전용 경로. Scaffold 경로(/api/cases/:id/scaffold)와 파일을 공유하지 않는다.
 */
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

/**
 * 올린 기록 파일(xlsx, docx)의 내용을 돌려준다. 파일은 저장하지 않고, 추출한 텍스트만
 * 응답한다. 외부(LLM)로는 아무것도 보내지 않는다. 비식별은 이 뒤 사례를 만들어
 * 분석할 때 지금 Write와 같은 경로로 처리된다.
 */
router.post('/inspect', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '파일이 없습니다.' });
    }
    const result = await inspectRecordFile(file.buffer, file.originalname || '');
    return res.json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || '파일을 읽지 못했습니다.' });
  }
});

export default router;
