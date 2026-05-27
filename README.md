# Haven Journal 📖🌱

**Haven Journal** is a cozy, private, and mindful digital sanctuary designed for self-reflection and personal growth. By combining an intimate, warm user interface with modern retrieval-augmented generation (RAG) and vector similarity search, it allows you to chronicle your life, explore recurring emotional patterns, and hold gentle conversations with your past pages.

---

## 🛠️ The Tech Stack

The application is built using a modern, decoupled client-server architecture:

### 1. Frontend (Hosted on Vercel)
* **Core**: [React 19](https://react.dev/) + [Vite](https://vite.dev/) + [TypeScript](https://www.typescriptlang.org/) for a lightweight, lightning-fast Single Page Application (SPA).
* **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) for fluid responsive layout design, incorporating soft pastel warm-paper palettes, glassmorphism elements, and editorial serif typography.
* **Icons**: [Lucide React](https://lucide.dev/) for a clean, consistent, and organic iconography set.

### 2. Backend API (Hosted on Render)
* **Runtime**: [Node.js](https://nodejs.org/) & [Express](https://expressjs.com/) configured with TypeScript (`tsx`).
* **ORM**: [Prisma Client](https://www.prisma.io/) to orchestrate relational database queries and PostgreSQL operations.
* **Security & Auth**:
  - Stateless **JSON Web Tokens (JWT)** for horizontal scaling and secure user sessions.
  - **bcryptjs** for secure password salting and hashing.
  - **CORS** middleware to restrict API traffic to authorized client domains.

### 3. Database & Vector Index (Hosted on Supabase)
* **Relational Store**: [Supabase PostgreSQL](https://supabase.com/) hosting tables for `User` records and `JournalEntry` journals.
* **Vector Index**: PostgreSQL `pgvector` extension for storing and performing high-performance similarity calculations on 768-dimensional embedding vectors.

### 4. Intelligence & Embeddings
* **Text Synthesis**: [Google Gemini 2.5 Flash](https://ai.google.dev/) via the official `@google/genai` SDK for mood mapping, summarizations, and chat synthesis.
* **Vector Embeddings**: `gemini-embedding-2-preview` to compile text content into multidimensional semantic coordinates.

---

## 🔍 How It Works: Under the Hood

### 1. Reflect & Inscribe (Journal Entry Creation)
When you submit a reflection, the system executes two parallel workflows:
1. **Mood & Tag Extraction**: The raw content is sent to `gemini-2.5-flash` with a structured system instruction to categorize the primary emotion (e.g. *peaceful*, *joyful*, *anxious*) and generate 2-4 mindful tag metadata keywords in a strict JSON schema format.
2. **Vector Indexing**: The title and content are joined and sent to the `gemini-embedding-2-preview` model. The resulting 768-dimension floating-point vector is saved directly in Supabase's `VectorRecord` table as a `vector` type.

---

### 2. Echoes of the Heart (Semantic Memory Search)
Rather than matching exact keywords, Haven Journal retrieves memories based on semantic intent and emotional meaning.
* **Mechanism**: When you type a query (e.g., *"times when I felt lonely but found hope"*), the query is transformed into a query vector.
* **Database Math**: The backend queries Supabase using pgvector's cosine distance operator (`<=>`). It calculates similarity directly inside the database index rather than pulling vectors into server memory:
  ```sql
  SELECT "entryId", (1 - (vector <=> $1::vector)) AS score
  FROM "VectorRecord"
  WHERE "userId" = $2
  ORDER BY vector <=> $1::vector ASC
  LIMIT 5;
  ```
  This returns matching journal pages with high affinity matches, sorting them by how closely they align to the feeling of your query.

---

### 3. Conversations with Past Pages (RAG Chat)
The chat interface allows you to ask questions about your past days, goals, or small happy moments.
* **Retrieval Phase**: Your prompt is vectorized and matches the top 4 most relevant historical segments from your diary.
* **Augmentation Phase**: The content of those 4 entries is retrieved and injected into the system prompt of `gemini-2.5-flash` as a local knowledge context sheet.
* **Generation Phase**: The model responds as a warm, intuitive Reflection Guide, answering your question using *only* facts retrieved from your diary, complete with gentle citations of the dates of the entries referenced.

---

### 4. Garden Insights (Weekly Reports)
The Weekly Garden computes insights based on both structural metrics and contextual synthesis.
* **Programmatic Metrics**: The backend calculates mood distribution cycles and tag frequencies using database aggregation.
* **Contextual Synthesis**: The full text of your recent reflections is sent to the Gemini engine to outline emotional shifts, focus topics, work-life balance themes, and provide 3 encouraging, actionable growth guidelines.

---

## 🔒 Sanctuary Settings (Privacy-First)
To keep the application highly scalable and privacy-respecting, Haven Journal allows you to supply your own **Reflection Engine Key** (Gemini API Key).
* If provided, the key is saved exclusively in your browser's local storage (`localStorage`) and sent to the server in the `x-gemini-api-key` header.
* The Express server extracts this header per request and instantiates a localized, isolated `GoogleGenAI` client. This ensures your key is never stored on the backend database or shared with third parties.
