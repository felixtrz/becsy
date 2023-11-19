import type { Component, ComponentType } from './component';

import type { Dispatcher } from './dispatcher';
import { Graph } from './datatypes/graph';
import type { SystemBox } from './system';
import type { SystemGroup } from './schedule';

export abstract class Plan {
	protected readonly graph: Graph<SystemBox>;

	constructor(
		protected readonly planner: Planner,
		protected readonly group: SystemGroup,
	) {
		this.graph = planner.graph.induceSubgraph(group.__systems);
	}

	abstract execute(time: number, delta: number): void;
	abstract initialize(): void;
	abstract finalize(): void;
}

class SimplePlan extends Plan {
	private readonly systems: SystemBox[];

	constructor(
		protected readonly planner: Planner,
		protected readonly group: SystemGroup,
	) {
		super(planner, group);
		this.systems = this.graph.topologicallySortedVertices;
		CHECK: if (
			this.systems.length > 1 &&
			(typeof process === 'undefined' || process.env.NODE_ENV === 'development')
		) {
			console.log('System execution order:');
			for (const system of this.systems) console.log(' ', system.name);
		}
	}

	execute(time: number, delta: number) {
		const dispatcher = this.planner.dispatcher;
		const systems = this.systems;
		this.group.__executed = true;
		for (let i = 0; i < systems.length; i++) {
			const system = systems[i];
			system.execute(time, delta);
			dispatcher.flush();
		}
	}

	initialize() {
		const dispatcher = this.planner.dispatcher;
		this.group.__executed = true;
		const initSystem = (system: SystemBox) => {
			system.prepare();
			system.initialize();
			dispatcher.flush();
			const systems = this.graph.traverse(system);
			if (!systems) return;
			for (let i = 0; i < systems.length; i++) initSystem(systems[i]);
		};

		const systems = this.graph.traverse();
		if (!systems) return;
		for (let i = 0; i < systems.length; i++) initSystem(systems[i]);
	}

	finalize() {
		const dispatcher = this.planner.dispatcher;
		this.group.__executed = true;
		const finalizeSystem = (system: SystemBox) => {
			system.finalize();
			dispatcher.flush();
			const systems = this.graph.traverse(system);
			if (!systems) return;
			for (let i = 0; i < systems.length; i++) finalizeSystem(systems[i]);
		};

		const systems = this.graph.traverse();
		if (!systems) return;
		for (let i = 0; i < systems.length; i++) finalizeSystem(systems[i]);
	}
}

export class Lane {
	id: number;
	readonly systems: SystemBox[] = [];

	constructor(id: number) {
		this.id = id;
	}

	add(...systems: SystemBox[]): void {
		for (const system of systems) system.lane = this;
		this.systems.push(...systems);
	}

	merge(other: Lane): Lane {
		if (this === other) return this;
		if (this.id === -1 || (other.id !== -1 && other.id < this.id))
			return other.merge(this);
		this.add(...other.systems);
		other.systems.length = 0;
		return this;
	}
}

export class Planner {
	readonly graph: Graph<SystemBox>;
	readers? = new Map<ComponentType<Component>, Set<SystemBox>>();
	writers? = new Map<ComponentType<Component>, Set<SystemBox>>();
	lanes: Lane[] = [];
	replicatedLane?: Lane;
	laneCount = 0;

	constructor(
		readonly dispatcher: Dispatcher,
		private readonly systems: SystemBox[],
		private readonly groups: SystemGroup[],
	) {
		this.graph = new Graph(systems);
		for (const componentType of dispatcher.registry.types) {
			this.readers!.set(componentType, new Set());
			this.writers!.set(componentType, new Set());
		}
	}

	get mainLane(): Lane | undefined {
		return this.lanes[0];
	}

	createLane(): Lane {
		const lane = new Lane(this.laneCount++);
		this.lanes.push(lane);
		return lane;
	}

	organize(): void {
		for (const group of this.groups) group.__collectSystems(this.dispatcher);
		for (const system of this.systems) system.buildQueries();
		for (const system of this.systems) system.buildSchedule();
		for (const group of this.groups) group.__buildSchedule();
		this.addComponentEntitlementDependencies();
		this.graph.seal();
		STATS: for (const system of this.systems)
			system.stats.worker = system.lane?.id ?? 0;
		delete this.readers;
		delete this.writers;
		for (const group of this.groups) {
			group.__plan = new SimplePlan(this, group);
		}
	}

	private addComponentEntitlementDependencies(): void {
		for (const [componentType, systems] of this.readers!.entries()) {
			for (const reader of systems) {
				for (const writer of this.writers!.get(componentType)!) {
					this.graph.addEdge(writer, reader, 1);
				}
			}
		}
	}
}
