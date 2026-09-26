"""M0: InfraRisk pavyzdžio (simple network „in2“) paleidimas be pakeitimų.

Pakartoja notebooks/event_based_simulations/simple_network.ipynb žingsnius be Jupyter.
Tinklas nukopijuojamas į simulation/out/m0, kad InfraRisk kopija (vendor/) liktų nepakeista.

Paleidimas: simulation/.venv/bin/python simulation/run/m0_example.py
"""

import base64
import json
import shutil
import sys
import warnings
from importlib.metadata import version
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # be langų – grafikai tik į failus
warnings.filterwarnings("ignore")

import infrarisk.src.plots as model_plots  # noqa: E402
import infrarisk.src.recovery_strategies as strategies  # noqa: E402
import infrarisk.src.simulation as simulation  # noqa: E402
from infrarisk.src.network_recovery import NetworkRecovery  # noqa: E402
from infrarisk.src.physical.integrated_network import IntegratedNetwork  # noqa: E402

import infrarisk_compat  # noqa: E402

SIM = Path(__file__).resolve().parents[1]
SOURCE = SIM / "vendor/infrarisk/infrarisk/data/networks/in2"
OUT = SIM / "out/m0"
NETWORK = OUT / "in2"
SCENARIO = NETWORK / "scenarios/test1"
SIM_STEP = 60

for pkg in ["pandas", "numpy", "pandapower", "wntr", "networkx", "geopandas"]:
    print(f"{pkg:11} {version(pkg)}")

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(SOURCE, NETWORK)

network = IntegratedNetwork(name="Simple")
network.load_networks(
    water_folder=NETWORK / "water",
    power_folder=NETWORK / "power",
    transp_folder=NETWORK / "transportation",
    sim_step=SIM_STEP,
)
infrarisk_compat.apply(network)
network.generate_integrated_graph()
network.generate_dependency_table(dependency_file=NETWORK / "dependecies.csv")
print("\nPriklausomybės:\n", network.dependency_table.wp_table)

network.set_disrupted_components(disruption_file=SCENARIO / "disruption_file.csv")
print("\nSugedę komponentai:", network.get_disrupted_components())

network.deploy_crews(init_power_crew_locs=["T_J8"], init_water_crew_locs=["T_J8"], init_transpo_crew_locs=["T_J8"])
recovery = NetworkRecovery(
    network,
    sim_step=SIM_STEP,
    pipe_close_policy="repair",
    pipe_closure_delay=10,
    line_close_policy="sensor_based_line_isolation",
    line_closure_delay=10,
)
sim = simulation.NetworkSimulation(recovery)

strategy = strategies.HandlingCapacityStrategy(network)
strategy.set_repair_order()
repair_order = strategy.get_repair_order()
(SCENARIO / "capacity").mkdir(parents=True, exist_ok=True)
print("Remonto tvarka:", repair_order)

sim.network_recovery.schedule_recovery(repair_order)
sim.expand_event_table()
metrics = sim.simulate_interdependent_effects(sim.network_recovery)
sim.write_results(str(SCENARIO / "capacity"), metrics)

metrics.calculate_power_resmetric(recovery)
metrics.calculate_water_resmetrics(recovery)
metrics.set_weighted_auc_metrics()
print("\nAtsparumo metrikos (AUC):", metrics.get_weighted_auc_metrics())

model_plots.plot_interdependent_effects(metrics, metric="pcs", title=False)
matplotlib.pyplot.savefig(OUT / "interdependent_effects.png", dpi=120, bbox_inches="tight")
# Palyginimui – autorių išsaugotas to paties grafiko vaizdas iš jų notebook'o.
notebook = json.loads((SIM / "vendor/infrarisk/notebooks/event_based_simulations/simple_network.ipynb").read_text())
for cell in notebook["cells"]:
    if "plot_interdependent_effects" in "".join(cell.get("source", "")):
        for output in cell.get("outputs", []):
            if "image/png" in output.get("data", {}):
                (OUT / "authors_interdependent_effects.png").write_bytes(base64.b64decode(output["data"]["image/png"]))

print(f"\nRezultatai: {SCENARIO / 'capacity'}\nGrafikas: {OUT / 'interdependent_effects.png'}")
sys.exit(0)
