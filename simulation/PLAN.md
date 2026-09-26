# SafeLink simuliacija – planas (InfraRisk + Klaipėdos duomenys)

> Tikslas: iš jau paruoštų tikrų Klaipėdos duomenų (ESO, „Klaipėdos vanduo“, GRPK, OSM, Sodra, JAR, PAGD)
> sudaryti InfraRisk įvesties tinklus, paleisti gedimų ir atsigavimo simuliacijas, o rezultatus
> (būsenos 🟢🟠🔴 per laiką) grąžinti į SafeLink žemėlapį.
>
> InfraRisk: <https://github.com/srijithbalakrishnan/dreaminsg-integrated-model>
> (peržiūrėtas commit `3e395de`, 2026-05-13).

---

## 1. Ką InfraRisk iš tikrųjų reikalauja

InfraRisk – **fizikinis** modelis, ne tik grafas. Kiekvienam tinklui jis leidžia tikrą skaičiavimą:

| Tinklas | Variklis | Įvesties failas | Ką skaičiuoja |
|---|---|---|---|
| Elektra | pandapower | `power/power.json` | srovių pasiskirstymas (power flow): kiek apkrovos aptarnaujama |
| Vanduo | WNTR (EPANET) | `water/water.inp` | slėgis ir srautai (PDA): kiek vandens poreikio patenkinama |
| Transportas | statinis srautų paskirstymas | `transportation/*.tntp` | remonto brigadų kelionės laikai, komponentų pasiekiamumas |
| Priklausomybės | – | `dependencies.csv` | siurblys ↔ variklis (`W_WP*` ↔ `P_MP*`), rezervuaras ↔ generatorius |
| Scenarijus | – | `scenarios/<id>/disruption_file.csv` | `time_stamp, components, fail_perc` |

Svarbios taisyklės:

- **Komponentų ID su prefiksais.** Elektra `P_`, vanduo `W_`, transportas `T_`. Po prefikso eina tipo kodas:
  - elektra: `B`, `BL` (šynos), `L` (linija), `TF`/`TFLO` (transformatorius), `LO` (apkrova), `MP` (variklis), `EG` (išorinis tinklas), `S` (jungiklis);
  - vanduo: `J` (mazgas), `P`/`PMA`/`PSC` (vamzdis / magistralė / įvadas), `WP` (siurblys), `R` (rezervuaras), `T` (bokštas), `PV` (sklendė);
  - transportas: `J`, `L`.

  Pavyzdžiui, `P_TFLO12` ar `W_PMA7`. Pagal kodą nustatomas komponento tipas ir remonto laikas, todėl kodai turi būti teisingi.
- **Transportas privalomas.** Remonto brigados važinėja kelių tinklu, o komponentai priskiriami artimiausiam kelio mazgui.
- **Koordinatės metrais.** Shelby pavyzdyje naudojama EPSG:3857. Mums natūralu **LKS94 (EPSG:3346)**: tai Lietuvos sistema, ir iš jos ESO bei GRPK duomenys ir kilę.
- **Priklausomybės tarp tinklų** InfraRisk'e yra tik trijų rūšių: siurblys ↔ elektros variklis, rezervuaras ↔ generatorius ir prieiga keliu. Pastatai modelyje yra **vartotojai**: elektros apkrovos (`P_LO`) ir vandens poreikiai (`W_J`). Pastatų susiejimui su socioekonomine analize naudojami *service area* sluoksniai.
- **Techninė būklė.** InfraRisk naudoja `DataFrame.append` (184 vietose), kurio nėra nuo pandas 2.0. Reikia **`pandas<2`** (Python 3.9–3.11) arba pataisos. Rekomenduojama pradėti nuo `pandas<2`.

---

## 2. Duomenų paruoštumas: ką turime ir ko trūksta

Principas lieka tas pats: **tikri duomenys nekeičiami**. Kai InfraRisk reikalauja parametro, kurio viešuose duomenyse nėra, naudojame **dokumentuotą inžinerinę prielaidą**. Ji įrašoma į `assumptions.yml` su šaltiniu ir pagrindimu, o rezultatuose pažymima kaip prielaida.

### 2.1 Elektra (pandapower)

| Reikia | Turime (tikra) | Trūksta → kaip užpildyti |
|---|---|---|
| Šynos (bus) su įtampa | ESO: 110/35 kV pastotės, SP, TR, įtampos lygis iš sluoksnio | – |
| Linijos: ilgis, jungtys | ESO 10 kV ir 0,4 kV kabeliai: geometrija ir `Shape_Length`; topologija jau `build:graph` | – |
| Linijų elektriniai parametrai | ✗ | **Prielaida:** pandapower standartinis tipas pagal įtampą (pvz., 10 kV `NA2XS2Y 1x240 RM/25`, 0,4 kV `NAYY 4x150 SE`) |
| Transformatoriai 10/0,4 kV: galia | ESO `RUSIS` (modulinė, stacionarioji…) | **Prielaida:** tipinė galia pagal rūšį (pvz., 0,4 / 0,63 MVA). Patikrinti ESO laisvų galių žemėlapį, bet jis dengia tik 110/35/10 kV pastotes |
| Išorinis tinklas | 110 kV pastotės (Jakai, Lypkiai…) | `EG` kiekvienoje 110 kV pastotėje |
| Apkrovos (kW) | Pastatų plotas ir paskirtis (GRPK/NTR); įmonių darbuotojai (Sodra) | **Prielaida:** kW/m² pagal paskirtį (gamyba, sandėlis, daugiabutis…). Patikrinti ESO atvirus suvartojimo duomenis (`datasets/gov/eso` – juridinių ir fizinių asmenų suvartojimas) kalibravimui |
| Jungiklių būsenos | ✗ | **Prielaida:** radiali schema pagal trumpiausio kelio medį (jau skaičiuojamas `build:graph`), kitos jungtys – atviri jungikliai `S` |

### 2.2 Vanduo (EPANET / WNTR)

| Reikia | Turime (tikra) | Trūksta → kaip užpildyti |
|---|---|---|
| Vamzdžiai: ilgis, skersmuo, medžiaga | „Klaipėdos vanduo“: `Diameter`, `MaterialType`, `geom.STLength()`, klasė (magistralė / gatvė / įvadas) | – |
| Mazgai, topologija | Vamzdžių galų sujungimas (jau `build:graph`) | – |
| Sklendės, hidrantai | „Klaipėdos vanduo“ | Sklendės kaip `PV`, hidrantai kaip `JHY` |
| Šiurkštumas (Hazen-Williams C) | Medžiaga | **Prielaida:** C pagal medžiagą (PE ~140, ketus ~100, plienas ~120) |
| Mazgų aukščiai | ✗ | **Tikras šaltinis:** Copernicus DEM GLO-30 (atviras) arba geoportal.lt reljefas |
| Šaltiniai (rezervuarai, siurblinės, bokštai) | OSM ir „Klaipėdos vanduo“ objektai (vandenvietės, siurblinės) – reikia surinkti | Zonos ribose: magistralės įėjimai kaip `R` su fiksuotu slėgiu (**prielaida**, pvz., 40 m) |
| Vandens poreikis | Pastatų plotas, paskirtis, darbuotojai | **Prielaida:** l/d pagal paskirtį ir plotą arba darbuotojų skaičių |
| Siurbliai ↔ elektra | Siurblinių vietos + ESO tinklas | Siurblinė → artimiausia TR (kaip pastatams) → `dependencies.csv` |

### 2.3 Transportas (TNTP)

| Reikia | Turime | Trūksta |
|---|---|---|
| Mazgai, jungtys, ilgiai | OSM keliai (jau `fetch:emergency`) | – |
| Pralaidumas, laisvo srauto laikas | `maxspeed` / kelio tipas | **Prielaida:** pralaidumas pagal kelio tipą |
| OD kelionių matrica | Darbuotojai (Sodra), gyvenamieji pastatai (GRPK) | **Prielaida:** paprasta gravitacinė matrica |
| Brigadų bazės | Gaisrinės (OSM), ESO ir „Klaipėdos vanduo“ bazės | ESO / KV bazių vietas surasti OSM arba prisiimti |

### 2.4 Gedimai (hazards)

InfraRisk moka: `radial` (taškas ir spindulys), `track` (linija), `random`, `custom` (sąrašas), `fragility_based`.

| Scenarijus Klaipėdai | InfraRisk tipas | Duomenys |
|---|---|---|
| Vieno komponento gedimas (TR, SP, 110 kV) | `custom` | Jau turime |
| Sprogimas / gaisras LEZ | `radial` (pvz., 300 m) | Jau turime |
| Potvynis (Danė, jūra, liūtis) | `fragility_based` | Aplinkos apsaugos agentūros potvynių grėsmės žemėlapiai – **reikia parsiųsti** |
| Audra / kelių gedimai | `random` / `track` | Meteo.lt (vėliau) |

---

## 3. Katalogų struktūra

```
simulation/
  PLAN.md                    ← šis failas
  environment.yml            Python 3.10, pandas<2, wntr, pandapower, geopandas, networkx; InfraRisk (pin 3e395de)
  assumptions.yml            VISOS prielaidos: parametras, reikšmė, šaltinis, pagrindimas
  prep/                      mūsų duomenys → InfraRisk formatai
    inventory.py             ką turime: kiekiai, laukų užpildymas, spragos (ataskaita)
    power.py                 ESO → power/power.json
    water.py                 Klaipėdos vanduo → water/water.inp
    transport.py             OSM keliai → transportation/*.tntp
    dependencies.py          siurbliai ↔ varikliai, service area (pastatai)
    ids.py                   stabilūs ID: InfraRisk ID ↔ šaltinio ID ↔ grafo mazgas
    validate.py              patikros (žr. 5 skyrių)
  networks/
    toy/                     bandomasis tinklas (4 skyrius, M1)
    klaipeda_lypkiai/        pirmoji tikra atkarpa
      power/ water/ transportation/ dependencies.csv id_map.csv
      scenarios/<id>/disruption_file.csv
  run/
    run_scenario.py          paleidžia InfraRisk scenarijų, rašo rezultatus
  export/
    to_map.py                rezultatai → src/data/sim/<scenarijus>.json (būsena pagal laiką, mūsų ID)
  tests/
```

`src/` (žemėlapis) nesikeičia. Simuliacija skaito tik `src/data/*.json`, o rašo tik `src/data/sim/`.

---

## 4. Etapai

### M0 – aplinka ir InfraRisk patikra
- Conda aplinka (Python 3.10, `pandas<2`), InfraRisk įdiegtas iš git (pin commit).
- Paleisti jų `simple_network` pavyzdį (`in2`) be pakeitimų.
- **Rezultatas:** žinome, kad įrankis veikia mūsų Mac'e. Užfiksuoti paketų versijas.

### M1 – bandomasis tinklas mūsų ID taisyklėmis
- Rankomis sudaryti mažą tinklą (elektra A–B–C–D, vanduo P–Q–R, priklausomybė B → Q).
- Gedimas `B` → tikimasi, kad `Q` sustos.
- **Rezultatas:** suprantame InfraRisk ID, rezultatų formatą ir metrikas.

### M2 – pirmoji tikra atkarpa: Lypkių 110 kV, tik elektra ⭐ pirmas tikras tikslas
Kodėl Lypkiai: maža atkarpa (23 LEZ + 23 kiti pastatai), bet tikra, o joje yra Rehau, Be-Ge Baltic ir Finegri.
- `power.py`: Lypkių 110 kV → 10 kV kabeliai → SP / TR → pastatų apkrovos (`P_LO`).
- Gedimas: vienas SP ar TR (`custom`).
- **Kryžminis patikrinimas:** InfraRisk rezultatas (be elektros likę pastatai) turi sutapti su mūsų grafo `affects` sąrašu tam mazgui. Jei nesutampa, ieškome klaidos topologijoje, dar prieš didinant tinklą.

### M3 – vanduo ir transportas toje pačioje zonoje
- `water.py`: LEZ vandentiekis + ribiniai rezervuarai, aukščiai iš DEM, šiurkštumas pagal medžiagą.
- `transport.py`: OSM keliai LEZ + ~1 km.
- `dependencies.py`: siurblinės ↔ jų transformatorinės (jei zonoje yra).
- Brigados: ESO, KV ir gaisrinių bazės.
- **Rezultatas:** vienas scenarijus su elektra, vandeniu ir remontu; metrikos `pcs` (elektra) ir vandens aptarnavimo kreivė.

### M4 – rezultatai žemėlapyje
- `to_map.py`: kiekvienam komponentui ir pastatui – būsena kiekvienu laiko žingsniu (`operational` / `degraded` / `failed`).
- Žemėlapyje: 🟢🟠🔴 spalvos ir laiko slankiklis (0 → 24 h). Geometrija nesikeičia, keičiasi tik būsena.
- Panelėje: paveikti darbuotojai ir pajamos per valandą (jau turime duomenis).

### M5 – plėtra
- Visa grafo zona (Jakai, Gedminai, Smeltė, Sendvaris), vėliau visa Klaipėda.
- Gedimai: `radial` (sprogimas LEZ), potvyniai (`fragility_based`).
- Atsigavimo strategijos (InfraRisk `HandlingCapacityStrategy`, centralumas, zonos) ir brigadų kiekis.

### M6 – optimizavimas ir RL (vėliau)
- InfraRisk MPC optimizatorius → vėliau RL aplinka (`state`, `action = repair/allocate`, `reward`).

---

## 5. Duomenų patikros (`validate.py`) – privalomos prieš kiekvieną simuliaciją

1. **ID:** unikalūs, su teisingu prefiksu ir tipo kodu; kiekvienas InfraRisk ID turi šaltinio ID (`id_map.csv`).
2. **Topologija:** kiekvienas TR pasiekia 110 kV pastotę, kiekvienas vandens mazgas – šaltinį; jokių „kabančių“ atkarpų be priežasties.
3. **Geometrija:** viena koordinačių sistema (EPSG:3346); ilgiai atitinka šaltinio `Shape_Length` / `geom.STLength()` (±1 %).
4. **Fizika:** pandapower power flow konverguoja bazinėje būsenoje; WNTR hidraulika be neigiamų slėgių bazinėje būsenoje.
5. **Palyginimas su grafu:** InfraRisk ryšiai ir `lez_graph.json` ryšiai sutampa (M2 kryžminis patikrinimas).
6. **Prielaidų ataskaita:** kiek parametrų tikri, kiek prielaidų (pvz., „linijų tipai: 100 % prielaida; ilgiai: 100 % ESO“).

---

## 6. Rezultatų formatas (į žemėlapį)

```json
{
  "scenario": "lypkiai_sp29_failure",
  "hazard": { "type": "custom", "components": ["P_B_SP29"] },
  "times_h": [0, 0.25, 1, 3, 6, 12, 24],
  "components": {
    "eso/6/5605": { "infrarisk_id": "P_B_SP29", "status": ["operational", "failed", "failed", "..."] }
  },
  "buildings": {
    "building/194113": { "power": ["ok", "out", "out", "..."], "water": ["ok", "ok", "low", "..."] }
  },
  "metrics": { "power_served": [1.0, 0.62, "..."], "water_served": [1.0, 0.97, "..."] },
  "assumptions": "assumptions.yml@<commit>"
}
```

Raktai – **mūsų ID** (`eso/…`, `water/…`, `building/…`), todėl žemėlapis juos iškart atpažįsta.

---

## 7. Rizikos

| Rizika | Poveikis | Mažinimas |
|---|---|---|
| Elektros ir vandens parametrai – prielaidos | Srautų dydžiai apytiksliai | Aiškiai žymėti; išvados apie **ryšius ir kaskadą** (tvirtos) atskirtos nuo **dydžių** (apytiksliai); kalibruoti ESO suvartojimo duomenimis |
| Jungiklių / sklendžių būsena nežinoma | Kaskados kelias gali skirtis nuo tikrovės | Radiali prielaida + jautrumo analizė (kitas rezervinis kelias) |
| InfraRisk senos priklausomybės (`pandas<2`) | Diegimo problemos | Pin versijas; jei reikia – minimali pataisa atskirame faile |
| Didelis tinklas (0,4 kV ≈ 20 000 kabelių) | Lėta simuliacija | 0,4 kV sujungti į apkrovą ties TR; plėsti palaipsniui |
| Vandens šaltiniai zonos ribose | Slėgis ties riba – prielaida | Plėsti zoną iki tikrų vandenviečių (M5) |

---

## 8. Sprendimai, kurių reikia prieš M2

1. **Pirmoji atkarpa:** Lypkių 110 kV (rekomenduojama, maža) ar Jakų 110 kV (84 LEZ pastatai, didesnė).
2. **Prielaidos:** ar sutinkame naudoti dokumentuotas inžinerines prielaidas trūkstamiems parametrams? Be jų InfraRisk fizikinio skaičiavimo paleisti negalima. Tikri duomenys lieka nepakeisti, o prielaidos matomos rezultatuose.
3. **Aplinka:** conda (rekomenduojama InfraRisk autorių) ar `venv` + pip.
