import { ManuscriptReviewModel as ManuscriptReviewMongoModel } from '../db/schema';
import { ManuscriptReviewDocument } from '../manuscriptReview/types';

export class ManuscriptReviewModel {
  async create(document: Omit<ManuscriptReviewDocument, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = `mreview_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const now = new Date();

    const newDoc = new ManuscriptReviewMongoModel({
      id,
      createdAt: now,
      updatedAt: now,
      ...document
    });

    await newDoc.save();
    return id;
  }

  async getById(id: string): Promise<ManuscriptReviewDocument | null> {
    const doc = await ManuscriptReviewMongoModel.findOne({ id }).lean().exec();
    if (!doc) return null;

    return {
      ...(doc as any),
      createdAt: new Date((doc as any).createdAt).toISOString(),
      updatedAt: new Date((doc as any).updatedAt).toISOString()
    } as ManuscriptReviewDocument;
  }

  async update(id: string, updates: Partial<ManuscriptReviewDocument>): Promise<void> {
    await ManuscriptReviewMongoModel.updateOne(
      { id },
      {
        $set: {
          ...updates,
          updatedAt: new Date()
        }
      }
    ).exec();
  }
}
