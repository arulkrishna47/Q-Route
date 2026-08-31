import os
import json
from app.network.osmnx_fetcher import fetch_and_process_network, save_network
from app.optimization.demand import fetch_poi_density_and_generate_demand
from app.optimization.routing import generate_candidate_routes

LOCATIONS = [
    {
        "id": "mylapore",
        "name": "Mylapore, Chennai, India",
        "bbox": (80.2585, 13.0245, 80.2785, 13.0425)
    },
    {
        "id": "koramangala",
        "name": "Koramangala, Bengaluru, India",
        "bbox": (77.6100, 12.9200, 77.6350, 12.9400)
    }
]

DATA_ROOT = os.path.join(os.path.dirname(__file__), 'data')

def ingest_all():
    print("Starting Q-ROUTE Multi-Location Ingestion...")
    for loc in LOCATIONS:
        print(f"\n--- Ingesting {loc['name']} ---")
        data_dir = os.path.join(DATA_ROOT, loc['id'])
        os.makedirs(data_dir, exist_ok=True)
        
        # 1. Fetch Network
        print("1. Fetching OSM Graph...")
        G = fetch_and_process_network(loc['bbox'])
        save_network(G, data_dir, loc['name'])
        
        # 2. Generate Demand
        print("2. Generating Demand based on POIs...")
        demand = fetch_poi_density_and_generate_demand(G, data_dir, loc['bbox'])
        
        # 3. Generate Candidate Routes
        print("3. Precomputing Candidate Routes...")
        candidate_routes_file = os.path.join(data_dir, 'candidate_routes.json')
        candidate_routes = generate_candidate_routes(G, demand, k=3)
        with open(candidate_routes_file, 'w') as f:
            json.dump(candidate_routes, f)
            
        print(f"Successfully fully ingested {loc['name']} to {data_dir}!")

if __name__ == "__main__":
    ingest_all()
