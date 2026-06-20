import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

export class StorageService {
  private supabase: SupabaseClient | null = null;
  private bucketName: string;
  private uploadDir: string;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    this.bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'journal-images';
    
    // We will save files in public/uploads for local testing fallback
    this.uploadDir = path.join(process.cwd(), 'public', 'uploads');

    if (supabaseUrl && supabaseKey) {
      try {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        console.log('[StorageService] Initialized Supabase Storage Client.');
      } catch (err) {
        console.error('[StorageService] Failed to initialize Supabase client:', err);
      }
    } else {
      console.log('[StorageService] Supabase credentials not found. Falling back to local disk storage in /public/uploads.');
    }
  }

  /**
   * Upload a file to the active storage engine (Supabase or Local Fallback).
   * Returns the URL of the uploaded image.
   */
  public async uploadFile(file: Express.Multer.File): Promise<string> {
    const fileExt = path.extname(file.originalname);
    const uniqueFilename = `${crypto.randomUUID()}${fileExt}`;

    if (this.supabase) {
      const { data, error } = await this.supabase.storage
        .from(this.bucketName)
        .upload(uniqueFilename, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        throw new Error(`Supabase Storage upload error: ${error.message}`);
      }

      const { data: publicUrlData } = this.supabase.storage
        .from(this.bucketName)
        .getPublicUrl(uniqueFilename);

      if (!publicUrlData || !publicUrlData.publicUrl) {
        throw new Error('Could not retrieve public URL for uploaded asset.');
      }

      return publicUrlData.publicUrl;
    } else {
      // Local fallback
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
      }

      const filePath = path.join(this.uploadDir, uniqueFilename);
      fs.writeFileSync(filePath, file.buffer);

      // Return a relative URL path that both Vite dev server and Express can resolve
      return `/uploads/${uniqueFilename}`;
    }
  }

  /**
   * Delete a file from the active storage engine.
   */
  public async deleteFile(imageUrl: string): Promise<void> {
    if (this.supabase) {
      try {
        // Retrieve the filename from the end of the URL
        const parts = imageUrl.split('/');
        const filename = parts[parts.length - 1];
        
        const { error } = await this.supabase.storage
          .from(this.bucketName)
          .remove([filename]);
        
        if (error) {
          console.warn(`[StorageService] Failed to delete file from Supabase: ${error.message}`);
        }
      } catch (err) {
        console.error('[StorageService] Error parsing imageUrl for Supabase deletion:', err);
      }
    } else {
      // Local fallback: delete file from public/uploads
      try {
        const parts = imageUrl.split('/');
        const filename = parts[parts.length - 1];
        const filePath = path.join(this.uploadDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error('[StorageService] Error deleting local file:', err);
      }
    }
  }
}
