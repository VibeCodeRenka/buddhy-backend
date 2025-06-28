import sys
import json
import chromadb
from sentence_transformers import SentenceTransformer

def query_database(query_text, top_k=5):
    """Query the ChromaDB database for relevant passages"""
    try:
        # Initialize ChromaDB client
        chroma_client = chromadb.PersistentClient(path="./chroma_db")
        collection = chroma_client.get_collection(name="spiritual_books")
        
        # Initialize sentence transformer
        model = SentenceTransformer('all-MiniLM-L6-v2')
        
        # Generate query embedding
        query_embedding = model.encode([query_text]).tolist()[0]
        
        # Query the database
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            include=['documents', 'metadatas', 'distances']
        )
        
        # Format results
        formatted_results = []
        if results['documents'] and results['documents'][0]:
            for i in range(len(results['documents'][0])):
                formatted_results.append({
                    'content': results['documents'][0][i],
                    'metadata': results['metadatas'][0][i],
                    'score': 1 - results['distances'][0][i]  # Convert distance to similarity score
                })
        
        return formatted_results
        
    except Exception as e:
        print(f"Error querying database: {e}", file=sys.stderr)
        return []

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python query_database.py <query> [top_k]")
        sys.exit(1)
    
    query = sys.argv[1]
    top_k = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    
    results = query_database(query, top_k)
    print(json.dumps(results, indent=2))
