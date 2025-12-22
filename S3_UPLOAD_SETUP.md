# S3/Supabase Storage Upload Setup for Surveyor Images

## Configuration

The S3 upload functionality is configured with:

- **Bucket Name**: `ESRoster`
- **Folder**: `surveyorimages`
- **Storage**: Supabase Storage (S3-compatible)
- **Endpoint**: `https://ryfqtdlayyuajpxfpihc.storage.supabase.co/storage/v1/s3`
- **Region**: `ap-southeast-2`

## Setup Requirements

### 1. Supabase Storage Bucket

Ensure the bucket `ESRoster` exists in your Supabase project:

1. Go to Supabase Dashboard → Storage
2. Create a new bucket named `ESRoster` (if it doesn't exist)
3. Set the bucket to **Public** (for public image URLs)
4. Configure bucket policies to allow uploads

### 2. Bucket Policies

The bucket needs the following policies. Since the app uses the **anon key** (not authenticated users), you need policies that allow anonymous access:

**Upload Policy** (for INSERT operations - allows uploads):

```sql
-- Allow uploads to surveyorimages folder (using anon key)
CREATE POLICY "Allow upload to surveyorimages"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'ESRoster'::text
  AND (storage.foldername(name))[1] = 'surveyorimages'::text
);
```

**Public Read Policy** (for SELECT operations - allows viewing images):

```sql
-- Allow public read access to all files in ESRoster bucket
CREATE POLICY "Public read access"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'ESRoster'::text);
```

**Important**: Your current policy `((bucket_id = 'ESRoster'::text) AND ((storage.foldername(name))[1] = 'surveyorimages'::text) AND (auth.role() = 'authenticated'::text))` requires authentication, but the app uses the anon key. You need to either:

1. **Use the policies above** (recommended for anon key usage), OR
2. **Set up authentication** in your app and keep your current policy

**Alternative: If you want to use authenticated users only**, you can use:

```sql
-- For authenticated users only
CREATE POLICY "Allow authenticated upload to surveyorimages"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ESRoster'::text
  AND (storage.foldername(name))[1] = 'surveyorimages'::text
);
```

**Note**: Your current policy requires authentication. If you're using the anon key (which is the default), you need the first set of policies above (using `TO public` instead of `TO authenticated`).

### 3. Installed Packages

The following packages are required and have been installed:

- `expo-image-picker` - For selecting images from device
- `expo-file-system` - For reading image files (already included with Expo)

## Usage

### In Surveyor Form

1. Click "Pick Image" button to select an image from device
2. Selected image will appear as a preview
3. When saving, the image will automatically upload to S3
4. The S3 URL will be saved to the surveyor's `photoUrl` field

### Manual URL Entry

You can still manually enter an image URL in the text field below the "Pick Image" button.

## File Naming

Uploaded images are named using the format:

```
surveyorimages/{surveyor_name}_{timestamp}.{extension}
```

Example: `surveyorimages/barry_mcdonald_1703123456789.jpg`

## Implementation Details

- **Upload Function**: `lib/s3-upload.js` → `uploadSurveyorImage()`
- **Image Picker**: Integrated in `app/surveyors.js` → `handlePickImage()`
- **Auto-Upload**: Images are uploaded automatically when saving a surveyor
- **Error Handling**: Upload errors are displayed via toast notifications

## Troubleshooting

### Upload Fails

1. Check that the `ESRoster` bucket exists in Supabase
2. Verify bucket policies allow uploads
3. Check browser console for detailed error messages
4. Ensure Supabase credentials are correctly configured

### Images Not Displaying

1. Verify bucket is set to **Public**
2. Check that the public URL is correctly generated
3. Verify CORS settings if accessing from web
