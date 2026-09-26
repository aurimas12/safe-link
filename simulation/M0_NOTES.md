# M0 – aplinka ir InfraRisk patikra: rezultatai

Data: 2026-09-26. InfraRisk commit `3e395de`.

## Aplinka

- Python 3.10 (Homebrew) + `simulation/.venv`, diegimas: `./simulation/setup.sh`.
- Užfiksuotos versijos (`requirements.txt`): pandas 1.5.3, numpy 1.26.4, pandapower 2.14.6, **wntr 1.3.2**,
  **networkx 2.8.8**, geopandas 0.14.4, **bokeh 3.4.1**.
- Paleidimas: `simulation/.venv/bin/python simulation/run/m0_example.py` (InfraRisk `simple_network` pavyzdys be Jupyter).

## Kas veikia

- Visi trys tinklai įkeliami (EPANET/WNTR, pandapower, TNTP), integruotas grafas, priklausomybės, gedimai,
  brigados, remonto tvarka, simuliacija iki galo, rezultatų CSV, grafikas.
- **Sutampa su autorių išsaugotais rezultatais:** remonto tvarka `['T_L2', 'P_L5', 'W_WP9', 'W_P21']`,
  atstatymo laikai (elektra 300 min, vanduo 432 min, transportas 360 min), elektros kreivė (~96 % iki ~5,3 h),
  pirmi 4 metrikų žingsniai.

## Rastos InfraRisk problemos ir pataisos (`run/infrarisk_compat.py`, InfraRisk kodas nekeičiamas)

| Problema | Priežastis | Sprendimas |
|---|---|---|
| `DataFrame.append` nėra | pandas ≥ 2 | pandas 1.5.3 |
| WNTR 1.1 nekompiliuojasi macOS arm64 | nėra paruošto paketo | WNTR 1.3.2 |
| `All graphs must be directed or undirected` | networkx ≥ 3 draudžia jungti DiGraph ir Graph | networkx 2.8.8 |
| `No module named bokeh` | yra environment.yml, bet ne setup.py | bokeh 3.4.1 |
| `base_transpo_flow` nėra | commit `3fa91f9` netyčia pašalino eilutę | atkuriama po įkėlimo |
| `sns` neapibrėžtas | plots.py neimportuoja seaborn | `plots.sns = seaborn` |
| `_power_outage` nėra | InfraRisk sukurtas su **WNTR 0.3.x** (siurblio požymis pašalintas WNTR 0.4) | požymis grąžintas WNTR 1.3 siurbliui: `status` = uždarytas, kol `_power_outage` = Closed (kaip WNTR 0.3); InfraRisk `pump_outage_event` – originalus |

## ✅ Rezultatas sutampa su autorių

| | Autoriai (notebook) | Mes |
|---|---|---|
| Remonto tvarka | `T_L2, P_L5, W_WP9, W_P21` | tokia pati |
| Atstatymo laikai | elektra 300, vanduo 432, transportas 360 min | tokie patys |
| ECS (vanduo), AUC | 2,7775 | 2,778 |
| PCS (elektra), AUC | 2,2195 | 2,220 |
| Vandens kreivė | 0 % nuo ~1 h iki ~5,3 h (siurblys be elektros) | tokia pati |

Palyginimas: `out/m0/interdependent_effects.png` (mes) ir `out/m0/authors_interdependent_effects.png` (autoriai).
Skirtumas tik x ašies ilgyje (mūsų simuliacija sustoja anksčiau – InfraRisk nutraukia, kai 3 žingsnius paslauga ≥ 98 %).

### Kaip rasta
Pirmoji emuliacija (WNTR taisyklės) siurblio neišlaikė išjungto: taisyklės tikrinamos tik kas `rule_timestep`
(360 s), o vienkartinis „įjungti“ kiekvieno intervalo pabaigoje įjungdavo siurblį. WNTR 0.3 `_power_outage`
buvo atskiras požymis, kurį gerbė pati siurblio būsena – jį ir grąžinome.
