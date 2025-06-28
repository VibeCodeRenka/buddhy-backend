import os
import PyPDF2
from sentence_transformers import SentenceTransformer
import chromadb
from chromadb.config import Settings
import json
import re
from typing import List, Dict

class BookRAGProcessor:
    def __init__(self, books_folder_path: str):
        self.books_folder_path = books_folder_path
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        
        # Initialize ChromaDB
        self.chroma_client = chromadb.PersistentClient(path="./chroma_db")
        self.collection = self.chroma_client.get_or_create_collection(
            name="spiritual_books",
            metadata={"hnsw:space": "cosine"}
        )
        
    def extract_text_from_pdf(self, pdf_path: str) -> str:
        """Extract text from a PDF file"""
        text = ""
        try:
            with open(pdf_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page in pdf_reader.pages:
                    text += page.extract_text() + "\n"
        except Exception as e:
            print(f"Error reading {pdf_path}: {e}")
        return text
    
    def clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        # Remove extra whitespace and newlines
        text = re.sub(r'\s+', ' ', text)
        # Remove special characters but keep basic punctuation
        text = re.sub(r'[^\w\s\.\,\!\?\;\:\-\(\)]', '', text)
        return text.strip()
    
    def chunk_text(self, text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
        """Split text into overlapping chunks"""
        words = text.split()
        chunks = []
        
        for i in range(0, len(words), chunk_size - overlap):
            chunk = ' '.join(words[i:i + chunk_size])
            if len(chunk.strip()) > 50:  # Only add meaningful chunks
                chunks.append(chunk)
        
        return chunks
    
    def process_all_books(self):
        """Process all PDF books in the folder"""
        print("Starting to process books...")
        
        # Get all PDF files
        pdf_files = [f for f in os.listdir(self.books_folder_path) if f.endswith('.pdf')]
        
        if not pdf_files:
            print("No PDF files found in the Books folder!")
            return
        
        all_chunks = []
        all_metadatas = []
        all_ids = []
        
        for pdf_file in pdf_files:
            print(f"Processing: {pdf_file}")
            pdf_path = os.path.join(self.books_folder_path, pdf_file)
            
            # Extract text
            raw_text = self.extract_text_from_pdf(pdf_path)
            if not raw_text.strip():
                print(f"No text extracted from {pdf_file}")
                continue
            
            # Clean text
            clean_text = self.clean_text(raw_text)
            
            # Chunk text
            chunks = self.chunk_text(clean_text)
            
            # Prepare for vector database
            book_name = pdf_file.replace('.pdf', '')
            for i, chunk in enumerate(chunks):
                all_chunks.append(chunk)
                all_metadatas.append({
                    'book': book_name,
                    'chunk_id': i,
                    'source': pdf_file
                })
                all_ids.append(f"{book_name}_chunk_{i}")
            
            print(f"Processed {len(chunks)} chunks from {pdf_file}")
        
        # Generate embeddings and store in ChromaDB
        print("Generating embeddings and storing in database...")
        
        # Process in batches to avoid memory issues
        batch_size = 100
        for i in range(0, len(all_chunks), batch_size):
            batch_chunks = all_chunks[i:i + batch_size]
            batch_metadatas = all_metadatas[i:i + batch_size]
            batch_ids = all_ids[i:i + batch_size]
            
            # Generate embeddings
            embeddings = self.model.encode(batch_chunks).tolist()
            
            # Add to ChromaDB
            self.collection.add(
                documents=batch_chunks,
                embeddings=embeddings,
                metadatas=batch_metadatas,
                ids=batch_ids
            )
            
            print(f"Processed batch {i//batch_size + 1}/{(len(all_chunks) + batch_size - 1)//batch_size}")
        
        print(f"Successfully processed {len(all_chunks)} chunks from {len(pdf_files)} books!")
        
        # Save processing summary
        summary = {
            'total_books': len(pdf_files),
            'total_chunks': len(all_chunks),
            'books_processed': [f.replace('.pdf', '') for f in pdf_files]
        }
        
        with open('processing_summary.json', 'w') as f:
            json.dump(summary, f, indent=2)
        
        print("Processing complete! Summary saved to processing_summary.json")

def main():
    # Update this path to point to your Books folder
    books_folder = input("Enter the full path to your Books folder (or press Enter for default): ").strip()
    
    if not books_folder:
        # Default path assuming script is run from Desktop/ChatWithGod-Backend
        books_folder = "../BookRAG/Books"
    
    if not os.path.exists(books_folder):
        print(f"Error: Books folder not found at {books_folder}")
        print("Please make sure the path is correct.")
        return
    
    processor = BookRAGProcessor(books_folder)
    processor.process_all_books()

if __name__ == "__main__":
    main()
