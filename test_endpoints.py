import urllib.request
import json

BASE = "http://localhost:8000"

def test_endpoint(url, method="GET", data=None):
    try:
        req = urllib.request.Request(url, method=method)
        if data:
            req.add_header('Content-Type', 'application/json')
            req.data = json.dumps(data).encode('utf-8')
        
        with urllib.request.urlopen(req) as res:
            body = res.read().decode('utf-8')
            parsed = json.loads(body)
            print(f"[{method}] {url} -> 200 OK")
            
            # Print a snippet of the result to prove it's real
            if isinstance(parsed, dict) and 'status' in parsed:
                print(f"   Response status: {parsed['status']}")
            elif isinstance(parsed, dict) and 'fitness' in parsed:
                print(f"   Fitness: {parsed['fitness']:.2f}")
                print(f"   Metrics: {json.dumps(parsed.get('metrics', {}), indent=2)}")
            elif isinstance(parsed, dict) and 'nodes' in parsed:
                print(f"   Nodes count: {len(parsed['nodes'])}, Edges count: {len(parsed['edges'])}")
            else:
                print(f"   Snippet: {str(parsed)[:200]}...")
            print("-" * 40)
    except Exception as e:
        print(f"[{method}] {url} -> ERROR: {e}")
        print("-" * 40)

print("--- API SMOKE TEST ---")
test_endpoint(f"{BASE}/health")
test_endpoint(f"{BASE}/network")

payload = {
    "time": 1.0,
    "congestion": 1.0,
    "co2": 1.0,
    "penalty": 10.0
}

test_endpoint(f"{BASE}/optimize/baseline", method="POST", data=payload)
test_endpoint(f"{BASE}/optimize/qpso?particles=5&iterations=10", method="POST", data=payload)
