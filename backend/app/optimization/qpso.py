import numpy as np
import time

def evaluate_fitness(x_discrete, candidate_routes, edge_indices, capacities, free_flow_times, lengths, weights, objective_func):
    """
    Evaluate a particle's position.
    x_discrete: array of chosen route indices, shape (num_flows,)
    """
    num_edges = len(capacities)
    edge_volumes = np.zeros(num_edges)
    
    # Simulate flow
    for i, choice in enumerate(x_discrete):
        route = candidate_routes[i]
        if not route['paths']:
            continue
        
        # Clip choice to valid range
        idx = min(max(int(choice), 0), len(route['paths']) - 1)
        path = route['paths'][idx]
        vol = route['volume']
        
        # Add volume to edges
        for u, v in zip(path[:-1], path[1:]):
            edge = (u, v, 0)
            if edge in edge_indices:
                edge_idx = edge_indices[edge]
                edge_volumes[edge_idx] += vol
                
    # Evaluate
    total_cost, metrics = objective_func(edge_volumes, capacities, free_flow_times, lengths, weights)
    return total_cost, metrics, edge_volumes

def qpso_optimize(candidate_routes, edge_data, weights, objective_func,
                  num_particles=20, max_iter=50, beta_start=0.9, beta_end=0.4):
    """
    Quantum-behaved Particle Swarm Optimization (QPSO)
    """
    print(f"Starting QPSO with {num_particles} particles, {max_iter} iterations.")
    start_time = time.time()
    
    # Network arrays for fast evaluation
    edge_indices = {edge: idx for idx, edge in enumerate(edge_data['edges'])}
    capacities = np.array(edge_data['capacities'])
    free_flow_times = np.array(edge_data['free_flow_times'])
    lengths = np.array(edge_data['lengths'])
    
    num_flows = len(candidate_routes)
    
    # Initialize particles
    # x: continuous position, shape (num_particles, num_flows)
    x = np.zeros((num_particles, num_flows))
    max_routes = np.zeros(num_flows)
    
    for i, route in enumerate(candidate_routes):
        max_idx = max(0, len(route['paths']) - 1)
        max_routes[i] = max_idx
        # Uniform random start
        x[:, i] = np.random.uniform(0, max_idx, size=num_particles)
        
    # pbest: personal best position and fitness
    pbest_x = np.copy(x)
    pbest_fitness = np.full(num_particles, np.inf)
    
    # gbest: global best position and fitness
    gbest_x = np.zeros(num_flows)
    gbest_fitness = np.inf
    
    best_metrics = None
    best_edge_volumes = None
    
    # History for convergence tracking
    fitness_history = []
    edge_volumes_history = []
    
    for t in range(max_iter):
        # Beta annealing
        beta = beta_start - (beta_start - beta_end) * (t / max_iter)
        
        # Evaluate fitness
        for i in range(num_particles):
            # Discretize position for evaluation
            x_discrete = np.round(x[i]).astype(int)
            x_discrete = np.clip(x_discrete, 0, max_routes)
            
            fitness, metrics, edge_vols = evaluate_fitness(
                x_discrete, candidate_routes, edge_indices, capacities, free_flow_times, lengths, weights, objective_func)
                
            if fitness < pbest_fitness[i]:
                pbest_fitness[i] = fitness
                pbest_x[i] = np.copy(x[i])
                
                if fitness < gbest_fitness:
                    gbest_fitness = fitness
                    gbest_x = np.copy(x[i])
                    best_metrics = metrics
                    best_edge_volumes = edge_vols
                    
        fitness_history.append(gbest_fitness)
        if best_edge_volumes is not None:
            edge_volumes_history.append(best_edge_volumes.tolist())
        else:
            edge_volumes_history.append([])
        
        # QPSO Update Rule
        mbest = np.mean(pbest_x, axis=0) # Mean best position
        
        for i in range(num_particles):
            phi = np.random.uniform(0, 1, size=num_flows)
            # Local attractor
            p = phi * pbest_x[i] + (1 - phi) * gbest_x
            
            u = np.random.uniform(0, 1, size=num_flows)
            # Prevent log(0)
            u = np.maximum(u, 1e-10)
            
            # Plus/minus sign
            L = np.random.choice([-1, 1], size=num_flows)
            
            # Position update (The Quantum-inspired delta-potential well equation)
            x[i] = p + L * beta * np.abs(mbest - x[i]) * np.log(1 / u)
            
            # Bound x
            x[i] = np.clip(x[i], 0, max_routes)
            
        if t % 10 == 0 or t == max_iter - 1:
            print(f"Iteration {t}: Best Fitness = {gbest_fitness:.4f}")
            
    print(f"QPSO completed in {time.time() - start_time:.2f} seconds.")
    
    # Final discretize gbest
    final_assignment = np.round(gbest_x).astype(int)
    final_assignment = np.clip(final_assignment, 0, max_routes)
    
    return {
        'assignment': final_assignment.tolist(),
        'fitness': gbest_fitness,
        'metrics': best_metrics,
        'edge_volumes': best_edge_volumes.tolist() if best_edge_volumes is not None else [],
        'history': fitness_history,
        'edge_volumes_history': edge_volumes_history,
        'runtime': time.time() - start_time
    }
