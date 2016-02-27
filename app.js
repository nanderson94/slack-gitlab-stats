"use strict";

const request = require("request");
const config = require("./config.json");
const util = require("util");
const async = require("async");
const moment = require("moment");
const print = console.log;

let totalCalls = 0
let endDate = moment().subtract(1, "d");

request.get(config["baseurl"] + "api/v3/groups/"+config["groupid"]+"/projects?per_page=100&private_token="+config["private-token"], function(err, res, body) {
	totalCalls++
	let projectIds = [];
	let projectCommits = {}
	let projectNames = {}
	body = JSON.parse(body);
	for (let i=0,len=body.length; i < len; i++) {
		projectNames[body[i].id] = body[i].name;
		projectIds.push(body[i].id);
	}
	function getCommits(projectId, callback) {
		request.get(config["baseurl"] + "api/v3/projects/" + projectId + "/repository/commits?per_page=100&private_token=" + config["private-token"], function(err, res, body) {
			totalCalls++
			if (err) {
				callback(err, null);
			}
			body = JSON.parse(body);
			let recentCommits = [];
			for (let i=0,len=body.length; i < len; i++) {
				let commitTime = moment(body[i].created_at)
				if (commitTime.isAfter(endDate)) {
					recentCommits.push(body[i])
				}
				
			}
			callback(null, {"commits":recentCommits, "id": projectId})
		});
	}
	// function getMRs(projectId, callback) {
	// 	request.get(config["baseurl"] + "api/v3/projects/" + projectId + "/merge_requests?private_token=" + config["private-token"], function(err, res, body) {
	// 		if (err) {
	// 			callback(err, null);
	// 		}
	// 		body = JSON.parse(body);
	// 		let recentMRs = [];
	// 		for (let i=0,len=body.length; i < len; i++) {
	// 			let MRTime = moment(body[i].created_at)
	// 			if (MRTime.isAfter(endDate)) {
	// 				recentMRs.push(body[i])
	// 			}
	// 		}
	// 		callback(null, {"merges": })
	// 	})
	// }
	print(projectNames);
	request.get("https://slack.com/api/channels.list?token="+config["slack-token"], function(err, res, body) {
		totalCalls++
		let channelsList = {};
		body = JSON.parse(body)
		for (let i = 0, len = body.channels.length; i < len; i++) {
			let channel = body.channels[i];
			channelsList[channel.name] = channel.id;
		}
		async.map(projectIds, getCommits, function(err, results) {
			let userCommits = {}
			for (let i = 0, len = results.length; i < len; i++) {
				let result = results[i];
				// print("Project: "+projectNames[result["id"]]);
				// print("# Commits: "+result["commits"].length)
				// console.log(err);
				for (let j = 0, len = result.commits.length; j < len; j++) {
					let commit = result.commits[j];
					if (!(commit.author_name in userCommits)) {
						userCommits[commit.author_name] = {};
					}
					if (!(projectNames[result["id"]] in userCommits[commit.author_name])) {
						userCommits[commit.author_name][projectNames[result["id"]]] = 0;
					}
					userCommits[commit.author_name][projectNames[result["id"]]] += 1;
				}
			}
			let message = "";
			for (let i in userCommits) {
				let user = userCommits[i]
				let totalCommits = 0
				let projectBreakdown = ""
				for (let j in user) {
					totalCommits += user[j]
					projectBreakdown += util.format(" - %d commit%s in <#%s|%s>\n", user[j], user[j] > 1 ? "s" : "", channelsList[j], j)
				}
				message += util.format("%s made %d commit%s this week!\n", i, totalCommits, totalCommits > 1 ? "s" : "")
				message += projectBreakdown
			}
			if (message.length > 0) {
				request.post({
				  url: config["slack-hook"],
				  body: JSON.stringify({
				    "channel": config["slack-channel"],
				    "username": "Contribution Bot",
				    "icon_url": "https://gitlab.com/uploads/project/avatar/13083/gitlab-logo-square.png",
				    "attachments": [
				      {
				        "fallback": "Look at all dem commits dis week!",
				        "color": "#F05033",
				        "text": "*Congrats to these users for their contributions to `master` in SRCT projects over the past week!*",
				        "mrkdwn_in": ["text", "pretext", "fields"],
				        "fields": [
				        	{
				        		"value": util.format("```%s```", message),
				        		"short": true
				        	}
				        ]
				      }
				    ]
				  })
				}, function(err, res, body) {
				  err&&console.log(err);
				  body=="ok"||console.log(body);
				});
			} else {
				function getIssues(projectId, callback) {
					request.get(config["baseurl"] + "api/v3/projects/" + projectId + "/issues?state=opened&per_page=100&private_token=" + config["private-token"], function(err, res, body) {
						totalCalls++
						if (err) {
							callback(err, null);
						}
						body = JSON.parse(body);
						callback(null, body)
					});
				}
				async.map(projectIds, getIssues, function(err, results) {
					let issues = []
					for (let i = 0, len = results.length; i < len; i++) {
						issues = issues.concat(results[i])
					}
					let projectIssues = {}
					for (let i = 0, len = issues.length; i < len; i++) {
						let issue = issues[i];
						if (!(issue.project_id in projectIssues)) {
							projectIssues[issue.project_id] = 0;
						}
						projectIssues[issue.project_id] += 1;
					}
					let message = util.format("There are currently %s total open issues!\n", projectIssues.length);
					let totalIssues = 0;
					for (let i in projectIssues) {
						let count = projectIssues[i]
						let name = projectNames[i]
						totalIssues += count
						//message += util.format("%s made %d commit%s this week!\n", i, totalIssues, totalIssues > 1 ? "s" : "")
						message += util.format("%d open issue%s in <#%s|%s>\n", count, count > 1 ? "s" : "", channelsList[name], name)
					}	
					request.post({
					  url: config["slack-hook"],
					  body: JSON.stringify({
					    "channel": config["slack-channel"],
					    "username": "Contribution Bot",
					    "icon_url": "https://gitlab.com/uploads/project/avatar/13083/gitlab-logo-square.png",
					    "attachments": [
					      {
					        "fallback": "Look at all dem commits dis week!",
					        "color": "#F05033",
					        "text": util.format("*Check out some of the %s current open issue%s Total Requests %s!*", totalIssues, totalIssues > 1 ? "s" : "", totalCalls),
					        "mrkdwn_in": ["text", "pretext", "fields"],
					        "fields": [
					        	{
					        		"value": util.format("```%s```", message),
					        		"short": true
					        	}
					        ]
					      }
					    ]
					  })
					}, function(err, res, body) {
					  err&&console.log(err);
					  body=="ok"||console.log(body);
					});
				});
			}
		});
	});
});