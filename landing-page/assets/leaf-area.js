(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  function element(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (name) { node.setAttribute(name, attrs[name]); });
    if (text) node.textContent = text;
    return node;
  }

  function postForm(url, body, feedback, button, onDone) {
    feedback.classList.remove("is-error");
    feedback.textContent = "";
    button.disabled = true;
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) throw new Error(data.error || "Não foi possível enviar agora.");
          onDone(data);
        });
      })
      .catch(function (error) {
        feedback.classList.add("is-error");
        feedback.textContent = error.message || "Não foi possível enviar agora.";
      })
      .then(function () { button.disabled = false; });
  }

  function goalBlock(label, current, goal, note) {
    var block = element("div", { class: "area-goal" });
    var head = element("div", { class: "area-goal-head" });
    head.appendChild(element("span", {}, label));
    head.appendChild(element("span", {}, current + " de " + goal));
    var bar = element("div", { class: "area-goal-bar", role: "progressbar", "aria-label": label, "aria-valuenow": String(current), "aria-valuemin": "0", "aria-valuemax": String(goal) });
    var fill = element("i");
    fill.style.width = Math.min(100, (current / goal) * 100) + "%";
    bar.appendChild(fill);
    block.appendChild(head);
    block.appendChild(bar);
    if (note) block.appendChild(element("p", { class: "area-goal-note" }, note));
    return block;
  }

  function regionForm(region, driversDone, apiBase, onSaved) {
    var form = element("form", { class: "area-form", novalidate: "" });
    form.innerHTML =
      '<fieldset class="area-roles"><legend>Como você quer usar a Leaf aqui?</legend>' +
      '<label><input type="radio" name="role" value="driver"> Quero dirigir</label>' +
      '<label><input type="radio" name="role" value="passenger"> Quero viajar</label></fieldset>' +
      '<label>Nome<input name="nome" autocomplete="name" maxlength="100" required></label>' +
      '<label>WhatsApp com DDD<input name="celular" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" required></label>' +
      '<label class="area-honeypot" aria-hidden="true">Site<input name="website" tabindex="-1" autocomplete="off"></label>' +
      '<label class="area-consent"><input name="consent" type="checkbox" required> <span>Concordo que a Leaf me avise pelo WhatsApp quando chegar nesta região, conforme a <a href="/privacy-policy">Política de Privacidade</a>.</span></label>' +
      '<button class="btn btn-green" type="submit">Pedir a Leaf aqui</button>' +
      '<p class="area-feedback" role="status"></p>';
    form.querySelector('input[value="' + (driversDone ? "passenger" : "driver") + '"]').checked = true;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var feedback = form.querySelector(".area-feedback");
      postForm(apiBase + "/api/public/region-interest", {
        regionKey: region.key,
        role: data.get("role"),
        nome: data.get("nome"),
        celular: data.get("celular"),
        website: data.get("website"),
        consent: form.elements.consent.checked
      }, feedback, form.querySelector("button"), function (result) {
        form.reset();
        feedback.textContent = result.alreadyRegistered
          ? "Seu pedido já estava registrado. Obrigado!"
          : "Pedido registrado. A gente avisa quando chegar aí.";
        if (!result.alreadyRegistered) onSaved(data.get("role"));
      });
    });
    return form;
  }

  function initArea(card) {
    var apiBase = card.getAttribute("data-api");
    var mapHost = card.querySelector("[data-area-map]");
    var select = card.querySelector("[data-area-select]");
    var detail = card.querySelector("[data-area-detail]");
    var state = { goals: null, counts: {}, byKey: {}, paths: {}, selected: null };

    function showRegion(key) {
      var region = state.byKey[key];
      if (!region) return;
      if (state.selected && state.paths[state.selected]) state.paths[state.selected].classList.remove("is-selected");
      state.selected = key;
      if (state.paths[key]) state.paths[key].classList.add("is-selected");
      select.value = key;
      detail.textContent = "";
      detail.appendChild(element("h3", {}, region.name));
      if (region.operating) {
        detail.appendChild(element("p", {}, "A Leaf já opera aqui. Baixe o app e peça sua corrida."));
        detail.appendChild(element("a", { class: "btn btn-green", href: "#baixar" }, "Baixar o app"));
        return;
      }
      var counts = state.counts[key] || {};
      var drivers = Number(counts.drivers) || 0;
      var passengers = Number(counts.passengers) || 0;
      var driversDone = Boolean(state.goals) && drivers >= state.goals.drivers;
      detail.appendChild(element("p", {}, "A Leaf ainda não chegou aqui. Peça para a gente vir."));
      if (state.goals) {
        detail.appendChild(goalBlock("1. Motoristas", drivers, state.goals.drivers, driversDone ? "Meta de motoristas atingida." : "Primeiro reunimos quem vai dirigir."));
        detail.appendChild(goalBlock("2. Passageiros", passengers, state.goals.passengers, driversDone ? "Agora é a vez de quem vai viajar." : "Passageiros já podem deixar o pedido."));
      }
      detail.appendChild(regionForm(region, driversDone, apiBase, function (role) {
        var field = role === "driver" ? "drivers" : "passengers";
        state.counts[key] = state.counts[key] || {};
        state.counts[key][field] = (Number(state.counts[key][field]) || 0) + 1;
        var feedbackText = "Pedido registrado. A gente avisa quando chegar aí.";
        showRegion(key);
        detail.querySelector(".area-feedback").textContent = feedbackText;
      }));
    }

    function drawMap(map) {
      var svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", map.viewBox);
      svg.setAttribute("aria-hidden", "false");
      map.regions.forEach(function (region) {
        var path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", region.d);
        path.setAttribute("tabindex", "0");
        path.setAttribute("role", "button");
        path.setAttribute("aria-label", region.name + (region.operating ? ", já operamos" : ", ainda não chegamos"));
        if (region.operating) path.classList.add("is-on");
        var title = document.createElementNS(SVG_NS, "title");
        title.textContent = region.name;
        path.appendChild(title);
        path.addEventListener("click", function () { showRegion(region.key); });
        path.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            showRegion(region.key);
          }
        });
        svg.appendChild(path);
        state.paths[region.key] = path;
        state.byKey[region.key] = region;
      });
      mapHost.appendChild(svg);

      function addGroup(label, items) {
        var group = element("optgroup", { label: label });
        items.forEach(function (item) {
          state.byKey[item.key] = item;
          group.appendChild(element("option", { value: item.key }, item.name));
        });
        select.appendChild(group);
      }
      addGroup("Já operamos", map.regions.filter(function (region) { return region.operating; }));
      addGroup("Ainda não chegamos: Rio", map.regions.filter(function (region) { return !region.operating; }));
      addGroup("Ainda não chegamos: outras cidades", map.cities);
      select.addEventListener("change", function () { showRegion(select.value); });
    }

    function showNumbers(numbers) {
      var section = document.querySelector("[data-numbers]");
      if (!section || !numbers) return;
      section.querySelector('[data-number="rides"]').textContent = Number(numbers.rides).toLocaleString("pt-BR");
      section.querySelector('[data-number="drivers"]').textContent = Number(numbers.drivers).toLocaleString("pt-BR");
      section.hidden = false;
    }

    fetch("/assets/leaf-area-map.json").then(function (response) { return response.json(); }).then(drawMap);
    fetch(apiBase + "/api/public/site-data")
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data) return;
        state.goals = data.goals || null;
        state.counts = data.regions || {};
        showNumbers(data.numbers);
        if (state.selected) showRegion(state.selected);
      })
      .catch(function () { return null; });
  }

  function initInvestorForm(form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var feedback = form.querySelector("[data-feedback]");
      postForm(form.getAttribute("data-api") + "/api/public/investor-interest", {
        nome: data.get("nome"),
        email: data.get("email"),
        empresa: data.get("empresa"),
        mensagem: data.get("mensagem"),
        website: data.get("website"),
        consent: form.elements.consent.checked
      }, feedback, form.querySelector("button"), function () {
        form.reset();
        feedback.textContent = "Contato recebido. A gente responde por e-mail.";
      });
    });
  }

  var card = document.querySelector("[data-area]");
  if (card) initArea(card);
  var investorForm = document.querySelector("[data-investor-form]");
  if (investorForm) initInvestorForm(investorForm);
})();
