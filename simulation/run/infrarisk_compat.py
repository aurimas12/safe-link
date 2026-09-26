"""InfraRisk suderinamumo pataisos – taikomos vykdymo metu, InfraRisk kodas (vendor/) nekeičiamas.

Kiekviena pataisa: kas neveikia, nuo kurio InfraRisk commit'o, ir kaip atkuriame ankstesnį elgesį.
"""

import infrarisk.src.plots as plots
import seaborn
from infrarisk.src.physical.integrated_network import IntegratedNetwork


def restore_base_transpo_flow(network: IntegratedNetwork) -> None:
    """InfraRisk 3fa91f9 („Now compatible with Python 3.10“) iš load_transpo_network pašalino
    `self.base_transpo_flow = tn`, bet recovery_strategies.py (HandlingCapacityStrategy ir kt.)
    jį vis dar naudoja. Atkuriame kaip prieš 3fa91f9: bazinis transporto srautas = įkeltas tinklas."""
    if not hasattr(network, "base_transpo_flow") and getattr(network, "tn", None) is not None:
        network.base_transpo_flow = network.tn


def restore_pump_power_outage() -> None:
    """InfraRisk siurblio elektros dingimą modeliuoja per WNTR 0.3.x siurblio požymį `_power_outage`
    (network_recovery.pump_outage_event: _InternalControlAction(pump, "_power_outage", Closed/Open, "status")).
    WNTR ≥ 0.4 šio požymio nebeturi, o mums reikia WNTR 1.3.2 (pirmoji su macOS arm64 paketu).

    Grąžiname jį taip, kaip veikė WNTR 0.3: požymis „Closed“ – siurblys uždarytas nepaisant kitų valdymų
    (pvz. bokšto lygio [CONTROLS]); „Open“ – siurblio būseną vėl lemia įprasti valdymai.
    WNTR 1.3 simuliatorius sprendimus priima pagal `link.status`, todėl papildome būtent šią savybę.
    InfraRisk pump_outage_event lieka originalus – vienkartiniai įvykiai tiksliai reikiamais laikais."""
    from wntr.network.base import LinkStatus
    from wntr.network.elements import Pump

    if getattr(Pump, "_safelink_power_outage", False):
        return
    original = Pump.status

    def status(self):
        if self._power_outage == LinkStatus.Closed:
            return LinkStatus.Closed
        return original.fget(self)

    Pump._power_outage = LinkStatus.Open  # numatytoji reikšmė – elektra yra
    Pump.status = property(status, original.fset, original.fdel, original.__doc__)
    Pump._safelink_power_outage = True


restore_pump_power_outage()


# plots.py naudoja `sns` (seaborn), bet jo neimportuoja (InfraRisk 3e395de) – grafikai lūžta su NameError.
plots.sns = seaborn


def apply(network: IntegratedNetwork) -> None:
    """Visos pataisos – kviesti po network.load_networks()."""
    restore_base_transpo_flow(network)
