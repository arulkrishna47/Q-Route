import numpy as np
import time
import copy

def run_dijkstra_baseline(G, candidate_routes, edge_data, weights, objective_func):
    """
    Baseline: assign all demand to the absolute shortest path (index 0).
    """
    start_time = time.time()
    num_edges = len(edge_data['capacities'])
    edge_volumes = np.zeros(num_edges)
    edge_indices = {edge: idx for idx, edge in enumerate(edge_data['edges'])}
    
    assignment = []
    
    for route in candidate_routes:
        assignment.append(0)
        if not route['paths']:
            continue
            
        path = route['paths'][0]
        vol = route['volume']
        
        for u, v in zip(path[:-1], path[1:]):
            edge = (u, v, 0)
            if edge in edge_indices:
                edge_idx = edge_indices[edge]
                edge_volumes[edge_idx] += vol
                
    capacities = np.array(edge_data['capacities'])
    free_flow_times = np.array(edge_data['free_flow_times'])
    lengths = np.array(edge_data['lengths'])
    
    total_cost, metrics = objective_func(edge_volumes, capacities, free_flow_times, lengths, weights)
    
    return {
        'assignment': assignment,
        'fitness': total_cost,
        'metrics': metrics,
        'edge_volumes': edge_volumes.tolist(),
        'runtime': time.time() - start_time
    }

def run_traffic_aware_dijkstra(candidate_routes, edge_data, weights, objective_func):
    """
    Greedy incremental loading to simulate traffic-aware assignment.
    """
    start_time = time.time()
    num_edges = len(edge_data['capacities'])
    edge_volumes = np.zeros(num_edges)
    edge_indices = {edge: idx for idx, edge in enumerate(edge_data['edges'])}
    capacities = np.array(edge_data['capacities'])
    free_flow_times = np.array(edge_data['free_flow_times'])
    lengths = np.array(edge_data['lengths'])
    
    assignment = []
    
    # Sort demand pairs by volume descending
    sorted_routes = sorted(enumerate(candidate_routes), key=lambda x: x[1]['volume'], reverse=True)
    assignment_map = {}
    
    for orig_idx, route in sorted_routes:
        if not route['paths']:
            assignment_map[orig_idx] = 0
            continue
            
        vol = route['volume']
        best_path_idx = 0
        best_cost = float('inf')
        
        for p_idx, path in enumerate(route['paths']):
            # Simulate adding volume to this path
            temp_vols = np.copy(edge_volumes)
            for u, v in zip(path[:-1], path[1:]):
                edge = (u, v, 0)
                if edge in edge_indices:
                    temp_vols[edge_indices[edge]] += vol
                    
            cost, _ = objective_func(temp_vols, capacities, free_flow_times, lengths, weights)
            if cost < best_cost:
                best_cost = cost
                best_path_idx = p_idx
                
        # Commit to the best path
        assignment_map[orig_idx] = best_path_idx
        path = route['paths'][best_path_idx]
        for u, v in zip(path[:-1], path[1:]):
            edge = (u, v, 0)
            if edge in edge_indices:
                edge_volumes[edge_indices[edge]] += vol
                
    for i in range(len(candidate_routes)):
        assignment.append(assignment_map.get(i, 0))
        
    total_cost, metrics = objective_func(edge_volumes, capacities, free_flow_times, lengths, weights)
    
    return {
        'assignment': assignment,
        'fitness': total_cost,
        'metrics': metrics,
        'edge_volumes': edge_volumes.tolist(),
        'runtime': time.time() - start_time
    }

def run_ga_baseline(candidate_routes, edge_data, weights, objective_func, pop_size=20, max_iter=30):
    start_time = time.time()
    num_edges = len(edge_data['capacities'])
    edge_indices = {edge: idx for idx, edge in enumerate(edge_data['edges'])}
    capacities = np.array(edge_data['capacities'])
    free_flow_times = np.array(edge_data['free_flow_times'])
    lengths = np.array(edge_data['lengths'])
    
    num_flows = len(candidate_routes)
    max_routes = np.array([max(0, len(r['paths']) - 1) for r in candidate_routes])
    
    # Initialize population
    population = np.zeros((pop_size, num_flows), dtype=int)
    for i in range(num_flows):
        population[:, i] = np.random.randint(0, max_routes[i] + 1, size=pop_size)
        
    def eval_individual(ind):
        vols = np.zeros(num_edges)
        for i, choice in enumerate(ind):
            route = candidate_routes[i]
            if not route['paths']: continue
            idx = min(max(choice, 0), max_routes[i])
            path = route['paths'][idx]
            vol = route['volume']
            for u, v in zip(path[:-1], path[1:]):
                edge = (u, v, 0)
                if edge in edge_indices: vols[edge_indices[edge]] += vol
        cost, metrics = objective_func(vols, capacities, free_flow_times, lengths, weights)
        return cost, metrics, vols

    best_cost = float('inf')
    best_ind = None
    best_metrics = None
    best_vols = None
    history = []
    edge_volumes_history = []
    
    for _ in range(max_iter):
        fitnesses = []
        for ind in population:
            cost, metrics, vols = eval_individual(ind)
            fitnesses.append(cost)
            if cost < best_cost:
                best_cost = cost
                best_ind = np.copy(ind)
                best_metrics = metrics
                best_vols = vols
        
        history.append(best_cost)
        if best_vols is not None:
            edge_volumes_history.append(best_vols.tolist())
        else:
            edge_volumes_history.append([])
        
        # Selection & Reproduction
        new_pop = np.zeros_like(population)
        for i in range(pop_size):
            i1, i2 = np.random.choice(pop_size, 2, replace=False)
            parent1 = population[i1] if fitnesses[i1] < fitnesses[i2] else population[i2]
            
            i3, i4 = np.random.choice(pop_size, 2, replace=False)
            parent2 = population[i3] if fitnesses[i3] < fitnesses[i4] else population[i4]
            
            # Crossover (Uniform)
            mask = np.random.rand(num_flows) > 0.5
            child = np.where(mask, parent1, parent2)
            
            # Mutation
            mut_mask = np.random.rand(num_flows) < 0.1
            random_genes = np.random.randint(0, max_routes + 1)
            child = np.where(mut_mask, random_genes, child)
            
            new_pop[i] = child
            
        population = new_pop
        
    return {
        'assignment': best_ind.tolist(),
        'fitness': best_cost,
        'metrics': best_metrics,
        'edge_volumes': best_vols.tolist() if best_vols is not None else [],
        'history': history,
        'edge_volumes_history': edge_volumes_history,
        'runtime': time.time() - start_time
    }
